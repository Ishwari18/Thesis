begin;

-- Trade lifecycle schema and trusted RPCs for the Privy-backed server flow.
alter table public.thesis_allocations
  add column if not exists idempotency_key uuid,
  add column if not exists side text not null default 'long';
alter table public.pacifica_execution_batches
  add column if not exists kind text not null default 'open';
alter table public.executions
  add column if not exists kind text not null default 'open';

do $migration$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.thesis_allocations'::regclass and conname = 'thesis_allocations_user_idempotency_key') then
    alter table public.thesis_allocations add constraint thesis_allocations_user_idempotency_key unique (user_id, idempotency_key);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.thesis_allocations'::regclass and conname = 'thesis_allocations_side_check') then
    alter table public.thesis_allocations add constraint thesis_allocations_side_check check (side in ('long', 'short'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pacifica_execution_batches'::regclass and conname = 'pacifica_execution_batches_kind_check') then
    alter table public.pacifica_execution_batches add constraint pacifica_execution_batches_kind_check check (kind in ('open', 'close'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.executions'::regclass and conname = 'executions_kind_check') then
    alter table public.executions add constraint executions_kind_check check (kind in ('open', 'close'));
  end if;
end
$migration$;

create table if not exists public.pacifica_trade_locks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  lock_key uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.pacifica_trade_locks enable row level security;
revoke all on table public.pacifica_trade_locks from public, anon, authenticated;

create or replace function public.acquire_pacifica_trade_lock_for_user(p_user_id uuid, p_lock_key uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_user_id is null or p_lock_key is null then raise exception 'Trade lock identity is required'; end if;
  insert into public.pacifica_trade_locks(user_id, lock_key, expires_at)
    values (p_user_id, p_lock_key, now() + interval '2 minutes')
    on conflict (user_id) do update
      set lock_key = excluded.lock_key, expires_at = excluded.expires_at, created_at = now()
      where public.pacifica_trade_locks.expires_at <= now();
  return exists (select 1 from public.pacifica_trade_locks where user_id = p_user_id and lock_key = p_lock_key);
end
$function$;

create or replace function public.release_pacifica_trade_lock_for_user(p_user_id uuid, p_lock_key uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Trusted server role required'; end if;
  delete from public.pacifica_trade_locks where user_id = p_user_id and lock_key = p_lock_key;
end
$function$;

-- The side is fixed when the immutable allocation snapshot is created.
create or replace function public.create_thesis_allocation_for_user(
  p_user_id uuid,
  p_thesis_slug text,
  p_collateral numeric,
  p_leverage integer,
  p_side text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare
  thesis_row public.theses%rowtype;
  allocation_id uuid;
  revision_id uuid;
  asset_count integer;
  total_weight numeric;
  existing_row public.thesis_allocations%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then raise exception 'Application user not found'; end if;
  if p_thesis_slug is null or p_leverage is null or p_leverage not in (2, 3, 5) or p_side is null or p_side not in ('long', 'short')
     or p_idempotency_key is null or p_collateral is null or p_collateral <= 0
     or p_collateral::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'Invalid allocation inputs'; end if;

  select * into existing_row from public.thesis_allocations
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('allocation_id', existing_row.id, 'status', existing_row.status, 'existing', true);
  end if;

  select * into thesis_row from public.theses where slug = p_thesis_slug and status = 'published' for share;
  if not found then raise exception 'Published thesis not found'; end if;
  select count(*)::integer, coalesce(sum(a.target_weight), 0)
    into asset_count, total_weight
    from public.thesis_assets a where a.thesis_id = thesis_row.id;
  if asset_count < 1 or asset_count > 10 or total_weight <> 1 then raise exception 'Thesis allocation composition is invalid'; end if;
  select id into revision_id from public.thesis_revisions where thesis_id = thesis_row.id order by revision desc limit 1;

  insert into public.thesis_allocations(user_id, thesis_id, revision_id, collateral, leverage, status, side, idempotency_key)
    values (p_user_id, thesis_row.id, revision_id, p_collateral, p_leverage, 'pending', p_side, p_idempotency_key)
    returning id into allocation_id;
  insert into public.allocation_legs(allocation_id, market_id, direction, entry_weight, target_notional)
    select allocation_id, a.market_id,
      case when p_side = 'short' then case a.direction when 'long' then 'short'::public.position_direction else 'long'::public.position_direction end else a.direction end,
      a.target_weight, round(p_collateral * p_leverage * a.target_weight, 10)
    from public.thesis_assets a where a.thesis_id = thesis_row.id;
  return jsonb_build_object('allocation_id', allocation_id, 'status', 'pending', 'existing', false, 'leg_count', asset_count);
end
$function$;

create or replace function public.create_pacifica_execution_intent_for_user(
  p_user_id uuid, p_allocation_id uuid, p_idempotency_key uuid, p_legs jsonb
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare
  allocation_row public.thesis_allocations%rowtype;
  batch_row public.pacifica_execution_batches%rowtype;
  item jsonb;
  leg_id uuid;
  leg_side text;
  leg_qty numeric;
  client_id uuid;
  leg_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into allocation_row from public.thesis_allocations where id = p_allocation_id and user_id = p_user_id for update;
  if not found then raise exception 'Allocation not found'; end if;
  select * into batch_row from public.pacifica_execution_batches where allocation_id = p_allocation_id and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('batch_id', batch_row.id, 'existing', true, 'status', batch_row.status); end if;
  if allocation_row.status not in ('pending', 'open') then raise exception 'Allocation is not eligible for execution'; end if;
  if jsonb_typeof(p_legs) is distinct from 'array' or jsonb_array_length(p_legs) < 1 or jsonb_array_length(p_legs) > 10 then raise exception 'Execution batch must contain 1 to 10 legs'; end if;
  insert into public.pacifica_execution_batches(allocation_id, user_id, idempotency_key, kind, status)
    values (p_allocation_id, p_user_id, p_idempotency_key, 'open', 'pending') returning * into batch_row;
  for item in select value from jsonb_array_elements(p_legs) loop
    if jsonb_typeof(item) <> 'object' or (item - 'allocation_leg_id' - 'side' - 'requested_quantity' - 'client_order_id') <> '{}'::jsonb then raise exception 'Invalid execution leg'; end if;
    leg_id := (item->>'allocation_leg_id')::uuid;
    leg_side := item->>'side';
    leg_qty := (item->>'requested_quantity')::numeric;
    client_id := (item->>'client_order_id')::uuid;
    if leg_side not in ('bid', 'ask') or leg_qty <= 0 or client_id is null then raise exception 'Invalid execution leg'; end if;
    if not exists (select 1 from public.allocation_legs where id = leg_id and allocation_id = p_allocation_id) then raise exception 'Allocation leg does not belong to allocation'; end if;
    if exists (select 1 from public.executions where allocation_leg_id = leg_id and status in ('pending','submitted','partially_filled','submission_unknown')) then raise exception 'An unresolved execution already exists for this thesis leg'; end if;
    insert into public.executions(allocation_leg_id, batch_id, client_order_id, requested_quantity, filled_quantity, side, status, kind)
      values (leg_id, batch_row.id, client_id, leg_qty, 0, case when leg_side = 'bid' then 'buy' else 'sell' end, 'pending', 'open');
    update public.allocation_legs set requested_quantity = leg_qty where id = leg_id;
    leg_count := leg_count + 1;
  end loop;
  if leg_count <> (select count(*) from public.allocation_legs where allocation_id = p_allocation_id) then raise exception 'Open intent must cover every thesis leg'; end if;
  return jsonb_build_object('batch_id', batch_row.id, 'existing', false, 'status', 'pending');
end
$function$;

-- Close only the confirmed quantity owned by this thesis. Exchange net positions
-- are validated by the server immediately before this intent is sent.
create or replace function public.create_pacifica_close_intent_for_user(
  p_user_id uuid, p_allocation_id uuid, p_idempotency_key uuid
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare
  allocation_row public.thesis_allocations%rowtype;
  batch_row public.pacifica_execution_batches%rowtype;
  leg_row record;
  client_id uuid;
  close_qty numeric;
  result_legs jsonb := '[]'::jsonb;
  added integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into allocation_row from public.thesis_allocations where id = p_allocation_id and user_id = p_user_id for update;
  if not found then raise exception 'Allocation not found'; end if;
  if allocation_row.status <> 'open' then raise exception 'Only an open allocation can be closed'; end if;
  select * into batch_row from public.pacifica_execution_batches where allocation_id = p_allocation_id and idempotency_key = p_idempotency_key;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('legId', e.allocation_leg_id, 'symbol', m.symbol, 'side', case e.side when 'buy' then 'bid' else 'ask' end, 'quantity', e.requested_quantity::text, 'clientOrderId', e.client_order_id)), '[]'::jsonb)
      into result_legs from public.executions e join public.allocation_legs l on l.id = e.allocation_leg_id join public.markets m on m.id = l.market_id where e.batch_id = batch_row.id;
    return jsonb_build_object('batch_id', batch_row.id, 'existing', true, 'status', batch_row.status, 'legs', result_legs);
  end if;

  if exists (
    select 1 from public.executions e join public.allocation_legs l on l.id = e.allocation_leg_id
    where l.allocation_id = p_allocation_id and e.status in ('pending','submitted','partially_filled','submission_unknown')
  ) then raise exception 'An unresolved execution must be reconciled before closing this thesis'; end if;

  if not exists (select 1 from public.allocation_legs where allocation_id = p_allocation_id and filled_quantity > 0) then raise exception 'No confirmed fills are available to close'; end if;
  insert into public.pacifica_execution_batches(allocation_id, user_id, idempotency_key, kind, status)
    values (p_allocation_id, p_user_id, p_idempotency_key, 'close', 'pending') returning * into batch_row;

  for leg_row in
    select l.id, l.market_id, l.direction, l.filled_quantity,
      coalesce((select sum(e.filled_quantity) from public.executions e where e.allocation_leg_id = l.id and e.kind = 'close'), 0) as closed_quantity
    from public.allocation_legs l where l.allocation_id = p_allocation_id order by l.id
  loop
    if leg_row.filled_quantity <= 0 then continue; end if;
    close_qty := leg_row.filled_quantity - leg_row.closed_quantity;
    if close_qty <= 0 then continue; end if;
    client_id := gen_random_uuid();
    insert into public.executions(allocation_leg_id, batch_id, client_order_id, requested_quantity, filled_quantity, side, status, kind)
      values (leg_row.id, batch_row.id, client_id, close_qty, 0, case when leg_row.direction = 'long' then 'sell' else 'buy' end, 'pending', 'close');
    result_legs := result_legs || jsonb_build_array(jsonb_build_object(
      'legId', leg_row.id, 'symbol', (select symbol from public.markets where id = leg_row.market_id),
      'side', case when leg_row.direction = 'long' then 'ask' else 'bid' end,
      'quantity', close_qty::text, 'clientOrderId', client_id
    ));
    added := added + 1;
  end loop;
  if added = 0 then raise exception 'This allocation has no remaining confirmed quantity to close'; end if;
  return jsonb_build_object('batch_id', batch_row.id, 'existing', false, 'status', 'pending', 'legs', result_legs);
end
$function$;

-- Confirm cumulative fill totals from trades/history. Replays with the same
-- totals are no-ops; larger cumulative totals apply only the new delta.
create or replace function public.confirm_pacifica_execution_fills_for_user(
  p_batch_id uuid, p_user_id uuid, p_results jsonb
)
returns void
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare
  batch_row public.pacifica_execution_batches%rowtype;
  item jsonb;
  execution_row public.executions%rowtype;
  leg_row public.allocation_legs%rowtype;
  client_id uuid;
  new_quantity numeric;
  new_price numeric;
  new_fee numeric;
  delta_quantity numeric;
  delta_fee numeric;
  open_fee_total numeric;
  open_fee_share numeric;
  new_status text;
  sign_value numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into batch_row from public.pacifica_execution_batches where id = p_batch_id and user_id = p_user_id for update;
  if not found then raise exception 'Execution batch not found'; end if;
  if jsonb_typeof(p_results) is distinct from 'array' then raise exception 'Fill results must be an array'; end if;
  for item in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(item) <> 'object' or (item - 'client_order_id' - 'filled_quantity' - 'average_fill_price' - 'fee') <> '{}'::jsonb then raise exception 'Invalid fill result'; end if;
    client_id := (item->>'client_order_id')::uuid;
    new_quantity := (item->>'filled_quantity')::numeric;
    new_price := (item->>'average_fill_price')::numeric;
    new_fee := (item->>'fee')::numeric;
    if new_quantity <= 0 or new_price <= 0 or new_fee < 0 then raise exception 'Invalid fill totals'; end if;
    select * into execution_row from public.executions where batch_id = p_batch_id and client_order_id = client_id for update;
    if not found then raise exception 'Fill result does not belong to this batch'; end if;
    if execution_row.kind <> batch_row.kind or execution_row.status not in ('submitted','partially_filled','submission_unknown','filled') then raise exception 'Execution is not eligible for fill confirmation'; end if;
    if new_quantity > execution_row.requested_quantity or new_quantity < execution_row.filled_quantity or new_fee < execution_row.fee then raise exception 'Fill totals are inconsistent'; end if;
    if execution_row.status = 'filled' and new_quantity = execution_row.filled_quantity and new_fee = execution_row.fee and new_price = execution_row.average_fill_price then continue; end if;
    delta_quantity := new_quantity - execution_row.filled_quantity;
    delta_fee := new_fee - execution_row.fee;
    new_status := case when new_quantity >= execution_row.requested_quantity then 'filled' else 'partially_filled' end;
    select * into leg_row from public.allocation_legs where id = execution_row.allocation_leg_id for update;
    update public.executions set status = new_status, filled_quantity = new_quantity, average_fill_price = new_price, fee = new_fee where id = execution_row.id;

    if execution_row.kind = 'open' then
      if delta_quantity > 0 then
        update public.allocation_legs set
          entry_price = case when filled_quantity = 0 then new_price else ((filled_quantity * entry_price) + (delta_quantity * new_price)) / (filled_quantity + delta_quantity) end,
          filled_quantity = filled_quantity + delta_quantity,
          actual_notional = ((filled_quantity + delta_quantity) * (case when filled_quantity = 0 then new_price else ((filled_quantity * entry_price) + (delta_quantity * new_price)) / (filled_quantity + delta_quantity) end)),
          fees = fees + delta_fee
        where id = leg_row.id;
      elsif delta_fee > 0 then
        update public.allocation_legs set fees = fees + delta_fee where id = leg_row.id;
      end if;
      if new_quantity > 0 then update public.thesis_allocations set status = 'open' where id = batch_row.allocation_id and status = 'pending'; end if;
    else
      if delta_quantity > 0 then
        if leg_row.filled_quantity <= 0 or leg_row.entry_price is null then raise exception 'Close fill has no confirmed opening fill'; end if;
        if delta_quantity > leg_row.filled_quantity - coalesce((select sum(e.filled_quantity) from public.executions e where e.allocation_leg_id = leg_row.id and e.kind = 'close' and e.id <> execution_row.id), 0) then raise exception 'Close fill exceeds remaining thesis quantity'; end if;
        select coalesce(sum(e.fee), 0) into open_fee_total from public.executions e where e.allocation_leg_id = leg_row.id and e.kind = 'open';
        open_fee_share := case when leg_row.filled_quantity = 0 then 0 else open_fee_total * delta_quantity / leg_row.filled_quantity end;
        sign_value := case when leg_row.direction = 'long' then 1 else -1 end;
        update public.allocation_legs set
          realized_pnl = realized_pnl + sign_value * (new_price - leg_row.entry_price) * delta_quantity - open_fee_share - delta_fee,
          fees = fees + delta_fee
        where id = leg_row.id;
      elsif delta_fee > 0 then
        update public.allocation_legs set fees = fees + delta_fee where id = leg_row.id;
      end if;
    end if;
  end loop;

  update public.pacifica_execution_batches set status = case
    when exists(select 1 from public.executions where batch_id = p_batch_id and status = 'submission_unknown') then 'submission_unknown'
    when exists(select 1 from public.executions where batch_id = p_batch_id and status in ('submitted','partially_filled','pending')) then 'partial'
    when exists(select 1 from public.executions where batch_id = p_batch_id and status = 'filled') then 'submitted'
    else 'rejected' end, updated_at = now()
    where id = p_batch_id and user_id = p_user_id;

  if batch_row.kind = 'close' and not exists (
    select 1 from public.allocation_legs l where l.allocation_id = batch_row.allocation_id and l.filled_quantity > 0
      and l.filled_quantity > coalesce((select sum(e.filled_quantity) from public.executions e where e.allocation_leg_id = l.id and e.kind = 'close'), 0)
  ) then
    update public.thesis_allocations set status = 'closed', closed_at = coalesce(closed_at, now()) where id = batch_row.allocation_id and user_id = p_user_id;
  end if;
end
$function$;

-- Only explicit negative order evidence can resolve an unknown order as rejected.
-- Missing trade-history evidence is intentionally left unknown.
create or replace function public.resolve_unknown_pacifica_executions_for_user(
  p_batch_id uuid, p_user_id uuid, p_rejected_client_order_ids jsonb
)
returns integer
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare
  batch_row public.pacifica_execution_batches%rowtype;
  item jsonb;
  client_id uuid;
  changed integer := 0;
  count_changed integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into batch_row from public.pacifica_execution_batches where id = p_batch_id and user_id = p_user_id for update;
  if not found then raise exception 'Execution batch not found'; end if;
  if not exists(select 1 from public.executions where batch_id = p_batch_id and status = 'submission_unknown') then raise exception 'Execution batch has no unknown outcomes to resolve'; end if;
  if jsonb_typeof(p_rejected_client_order_ids) is distinct from 'array' then raise exception 'Resolution evidence must be an array'; end if;
  for item in select value from jsonb_array_elements(p_rejected_client_order_ids) loop
    if jsonb_typeof(item) <> 'string' then raise exception 'Rejected order evidence must contain client order IDs'; end if;
    client_id := trim(both '"' from item::text)::uuid;
    update public.executions set status = 'rejected'
      where batch_id = p_batch_id and client_order_id = client_id and status = 'submission_unknown';
    get diagnostics count_changed = row_count;
    if count_changed <> 1 then raise exception 'Rejection evidence does not match an unknown order in this batch'; end if;
    changed := changed + count_changed;
  end loop;
  update public.pacifica_execution_batches set
    status = case when not exists(select 1 from public.executions where batch_id = p_batch_id and status = 'submission_unknown') then 'rejected' else 'submission_unknown' end,
    updated_at = now()
    where id = p_batch_id and user_id = p_user_id;
  return changed;
end
$function$;

create or replace function public.cancel_unsubmitted_thesis_allocation_for_user(p_allocation_id uuid, p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare changed integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Trusted server role required'; end if;
  if exists (select 1 from public.executions e join public.allocation_legs l on l.id = e.allocation_leg_id
    where l.allocation_id = p_allocation_id and e.status not in ('pending', 'rejected')) then
    raise exception 'Allocation has execution state that cannot be cancelled';
  end if;
  update public.thesis_allocations set status = 'cancelled'
    where id = p_allocation_id and user_id = p_user_id and status = 'pending';
  get diagnostics changed = row_count;
  return changed = 1;
end
$function$;

create or replace function public.mark_thesis_allocation_open_for_user(p_allocation_id uuid, p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare changed integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Trusted server role required'; end if;
  update public.thesis_allocations set status = 'open' where id = p_allocation_id and user_id = p_user_id and status = 'pending';
  get diagnostics changed = row_count;
  return changed = 1;
end
$function$;

revoke all on function public.acquire_pacifica_trade_lock_for_user(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_pacifica_trade_lock_for_user(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_thesis_allocation_for_user(uuid, text, numeric, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.create_pacifica_execution_intent_for_user(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_pacifica_close_intent_for_user(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.confirm_pacifica_execution_fills_for_user(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.resolve_unknown_pacifica_executions_for_user(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_unsubmitted_thesis_allocation_for_user(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_thesis_allocation_open_for_user(uuid, uuid) from public, anon, authenticated;

grant execute on function public.acquire_pacifica_trade_lock_for_user(uuid, uuid) to service_role;
grant execute on function public.release_pacifica_trade_lock_for_user(uuid, uuid) to service_role;
grant execute on function public.create_thesis_allocation_for_user(uuid, text, numeric, integer, text, uuid) to service_role;
grant execute on function public.create_pacifica_execution_intent_for_user(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.create_pacifica_close_intent_for_user(uuid, uuid, uuid) to service_role;
grant execute on function public.confirm_pacifica_execution_fills_for_user(uuid, uuid, jsonb) to service_role;
grant execute on function public.resolve_unknown_pacifica_executions_for_user(uuid, uuid, jsonb) to service_role;
grant execute on function public.cancel_unsubmitted_thesis_allocation_for_user(uuid, uuid) to service_role;
grant execute on function public.mark_thesis_allocation_open_for_user(uuid, uuid) to service_role;

commit;
