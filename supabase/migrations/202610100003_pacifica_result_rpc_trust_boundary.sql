-- Execution results are written only by trusted server code using the service role.
-- Bind the requested user explicitly so the server cannot accidentally reconcile a
-- batch belonging to a different authenticated user.
-- The initial migration's owner policies cover all commands. Remove direct browser
-- writes that could forge fills, allocation state, or ledger/P&L records. The intent
-- intent RPC remains the authenticated execution-intent creation boundary.
revoke all on table public.executions from anon, authenticated;
grant select on table public.executions to authenticated;
revoke all on table public.allocation_legs from anon, authenticated;
grant select on table public.allocation_legs to authenticated;
revoke all on table public.thesis_allocations from anon, authenticated;
grant select on table public.thesis_allocations to authenticated;
revoke all on table public.ledger_entries from anon, authenticated;
grant select on table public.ledger_entries to authenticated;

drop function if exists public.record_pacifica_execution_results(uuid,text,text,jsonb);

create function public.record_pacifica_execution_results(
  p_batch_id uuid,
  p_user_id uuid,
  p_status text,
  p_provider_error text,
  p_results jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  batch_row public.pacifica_execution_batches%rowtype;
  item jsonb;
  client_id uuid;
  order_status text;
  external_order_id text;
  expected_count integer;
  result_count integer := 0;
  submitted_count integer := 0;
  rejected_count integer := 0;
  changed_count integer;
  expected_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Trusted server role required';
  end if;
  if p_user_id is null then
    raise exception 'Execution batch user is required';
  end if;
  if p_status is null or p_status not in ('submitted', 'partial', 'rejected', 'submission_unknown') then
    raise exception 'Invalid execution batch result';
  end if;
  if p_provider_error is not null and char_length(p_provider_error) > 500 then
    raise exception 'Provider error is too long';
  end if;
  if p_results is null or jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'Execution results must be an array';
  end if;

  select * into batch_row
    from public.pacifica_execution_batches
    where id = p_batch_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'Execution batch not found';
  end if;
  if batch_row.status <> 'pending' then
    raise exception 'Execution batch is not pending';
  end if;

  select count(*)::integer into expected_count
    from public.executions where batch_id = p_batch_id;
  if expected_count < 1 or exists (
    select 1 from public.executions
      where batch_id = p_batch_id and status <> 'pending'
  ) then
    raise exception 'Execution batch is not in a reconcilable state';
  end if;

  if p_status = 'submission_unknown' then
    if jsonb_array_length(p_results) <> 0 then
      raise exception 'Unknown submissions cannot include per-order results';
    end if;
    update public.executions set status = 'submission_unknown'
      where batch_id = p_batch_id and status = 'pending';
    get diagnostics changed_count = row_count;
    if changed_count <> expected_count then
      raise exception 'Execution batch changed during reconciliation';
    end if;
  else
    if jsonb_array_length(p_results) <> expected_count then
      raise exception 'Execution results must match the batch exactly';
    end if;

    for item in select value from jsonb_array_elements(p_results) loop
      if jsonb_typeof(item) <> 'object'
         or not (item ? 'client_order_id')
         or not (item ? 'status')
         or not (item ? 'external_id')
         or (item - 'client_order_id' - 'status' - 'external_id') <> '{}'::jsonb
         or jsonb_typeof(item->'client_order_id') <> 'string'
         or jsonb_typeof(item->'status') <> 'string'
         or jsonb_typeof(item->'external_id') not in ('string', 'null') then
        raise exception 'Invalid per-order execution result';
      end if;
      begin
        client_id := (item->>'client_order_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid per-order client ID';
      end;
      order_status := item->>'status';
      external_order_id := item->>'external_id';
      if order_status not in ('submitted', 'rejected') then
        raise exception 'Invalid per-order status';
      end if;

      update public.executions
        set status = order_status, external_id = external_order_id
        where batch_id = p_batch_id and client_order_id = client_id and status = 'pending';
      get diagnostics changed_count = row_count;
      if changed_count <> 1 then
        raise exception 'Execution result is duplicate or does not belong to this batch';
      end if;
      result_count := result_count + 1;
      if order_status = 'submitted' then
        submitted_count := submitted_count + 1;
      else
        rejected_count := rejected_count + 1;
      end if;
    end loop;

    if result_count <> expected_count then
      raise exception 'Execution results must match the batch exactly';
    end if;
    expected_status := case
      when submitted_count = expected_count then 'submitted'
      when rejected_count = expected_count then 'rejected'
      else 'partial'
    end;
    if p_status <> expected_status then
      raise exception 'Batch status does not match per-order results';
    end if;
  end if;

  update public.pacifica_execution_batches
    set status = p_status, provider_error = p_provider_error, updated_at = now()
    where id = p_batch_id and user_id = p_user_id and status = 'pending';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'Execution batch changed during reconciliation';
  end if;
end
$function$;

revoke all on function public.record_pacifica_execution_results(uuid,uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_pacifica_execution_results(uuid,uuid,text,text,jsonb)
  to service_role;
