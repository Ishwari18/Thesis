-- Execution intents are committed before Pacifica is called. A timed-out request is
-- marked unknown and must be reconciled; it must never be automatically resubmitted.
create table public.pacifica_execution_batches (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.thesis_allocations(id),
  user_id uuid not null references public.profiles(id),
  idempotency_key uuid not null,
  status text not null default 'pending' check(status in ('pending','submitted','partial','rejected','submission_unknown')),
  provider_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(allocation_id,idempotency_key),
  unique(id,user_id)
);
create index pacifica_execution_batches_user_idx on public.pacifica_execution_batches(user_id,created_at desc);
alter table public.executions add column batch_id uuid references public.pacifica_execution_batches(id);
alter table public.executions add column client_order_id uuid;
alter table public.executions add constraint executions_client_order_id_key unique(client_order_id);
alter table public.executions drop constraint executions_status_check;
alter table public.executions add constraint executions_status_check check(status in ('pending','submitted','partially_filled','filled','cancelled','rejected','submission_unknown'));
create index executions_active_leg_idx on public.executions(allocation_leg_id) where status in ('pending','submitted','partially_filled','submission_unknown');
create unique index executions_one_unresolved_per_leg on public.executions(allocation_leg_id) where status in ('pending','submitted','partially_filled','submission_unknown');

alter table public.pacifica_execution_batches enable row level security;
create policy "execution batches own records" on public.pacifica_execution_batches for select using(user_id=auth.uid() or public.is_curator());

create or replace function public.create_pacifica_execution_intent(p_allocation_id uuid,p_idempotency_key uuid,p_legs jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare allocation_row public.thesis_allocations%rowtype; batch_row public.pacifica_execution_batches%rowtype; item jsonb; leg_id uuid; leg_side text; leg_qty numeric; client_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into allocation_row from public.thesis_allocations where id=p_allocation_id and user_id=auth.uid() for update;
  if not found then raise exception 'Allocation not found'; end if;
  if allocation_row.status not in ('pending','open') then raise exception 'Allocation is not eligible for execution'; end if;
  select * into batch_row from public.pacifica_execution_batches where allocation_id=p_allocation_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('batch_id',batch_row.id,'existing',true,'status',batch_row.status); end if;
  if jsonb_typeof(p_legs)<>'array' or jsonb_array_length(p_legs)<1 or jsonb_array_length(p_legs)>10 then raise exception 'Execution batch must contain 1 to 10 legs'; end if;
  insert into public.pacifica_execution_batches(allocation_id,user_id,idempotency_key,status) values(p_allocation_id,auth.uid(),p_idempotency_key,'pending') returning * into batch_row;
  for item in select value from jsonb_array_elements(p_legs) loop
    leg_id := (item->>'allocation_leg_id')::uuid;
    leg_side := item->>'side';
    leg_qty := (item->>'requested_quantity')::numeric;
    client_id := (item->>'client_order_id')::uuid;
    if leg_side not in ('bid','ask') or leg_qty<=0 then raise exception 'Invalid execution leg'; end if;
    if not exists(select 1 from public.allocation_legs where id=leg_id and allocation_id=p_allocation_id) then raise exception 'Allocation leg does not belong to allocation'; end if;
    if exists(select 1 from public.executions where allocation_leg_id=leg_id and status in ('pending','submitted','partially_filled','submission_unknown')) then raise exception 'An unresolved execution already exists for this thesis leg'; end if;
    insert into public.executions(allocation_leg_id,batch_id,client_order_id,requested_quantity,filled_quantity,side,status)
      values(leg_id,batch_row.id,client_id,leg_qty,0,case when leg_side='bid' then 'buy' else 'sell' end,'pending');
    update public.allocation_legs set requested_quantity=leg_qty where id=leg_id;
  end loop;
  return jsonb_build_object('batch_id',batch_row.id,'existing',false,'status','pending');
end $$;
revoke all on function public.create_pacifica_execution_intent(uuid,uuid,jsonb) from public;
grant execute on function public.create_pacifica_execution_intent(uuid,uuid,jsonb) to authenticated;

create or replace function public.record_pacifica_execution_results(p_batch_id uuid,p_status text,p_provider_error text,p_results jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare batch_row public.pacifica_execution_batches%rowtype; item jsonb; new_status text; order_status text;
begin
  select * into batch_row from public.pacifica_execution_batches where id=p_batch_id and user_id=auth.uid() for update;
  if not found then raise exception 'Execution batch not found'; end if;
  if batch_row.status<>'pending' then return; end if;
  if p_status not in ('submitted','partial','rejected','submission_unknown') then raise exception 'Invalid execution batch result'; end if;
  if p_status='submission_unknown' then
    update public.executions set status='submission_unknown' where batch_id=p_batch_id and status='pending';
  else
    for item in select value from jsonb_array_elements(coalesce(p_results,'[]'::jsonb)) loop
      order_status := item->>'status';
      if order_status not in ('submitted','rejected') then raise exception 'Invalid per-order status'; end if;
      update public.executions set status=order_status,external_id=item->>'external_id'
        where batch_id=p_batch_id and client_order_id=(item->>'client_order_id')::uuid and status='pending';
    end loop;
    if exists(select 1 from public.executions where batch_id=p_batch_id and status='pending') then raise exception 'Incomplete per-order result set'; end if;
  end if;
  update public.pacifica_execution_batches set status=p_status,provider_error=p_provider_error,updated_at=now() where id=p_batch_id;
end $$;
revoke all on function public.record_pacifica_execution_results(uuid,text,text,jsonb) from public;
grant execute on function public.record_pacifica_execution_results(uuid,text,text,jsonb) to authenticated;

-- Record one Pacifica order response per thesis leg. Accepted orders stay submitted;
-- this migration intentionally does not label them filled or copy net exchange positions.
