-- Privy-authenticated allocation saves.
-- Only the trusted server-side service role may execute this function.

create or replace function public.create_thesis_allocation_for_user(
  p_user_id uuid,
  p_thesis_slug text,
  p_collateral numeric,
  p_leverage integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $allocation$
declare
  thesis_row public.theses%rowtype;
  allocation_id uuid;
  revision_id uuid;
  asset_count integer;
  total_weight numeric;
  legs_eligible boolean;
begin
  if p_user_id is null
     or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Application user not found';
  end if;

  if p_thesis_slug is null
     or p_leverage is null
     or p_leverage not in (2, 3, 5)
     or p_collateral is null
     or p_collateral <= 0
     or p_collateral::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid allocation inputs';
  end if;

  select * into thesis_row
  from public.theses
  where slug = p_thesis_slug and status = 'published'
  for share;

  if not found then
    raise exception 'Published thesis not found';
  end if;

  select
    count(*)::integer,
    coalesce(sum(a.target_weight), 0),
    coalesce(
      bool_and(
        m.active
        and p_leverage <= m.max_leverage
        and p_collateral * p_leverage * a.target_weight
            >= coalesce(m.min_notional, 0)
      ),
      false
    )
  into asset_count, total_weight, legs_eligible
  from public.thesis_assets a
  join public.markets m on m.id = a.market_id
  where a.thesis_id = thesis_row.id;

  if asset_count < 1
     or asset_count > 10
     or total_weight <> 1
     or not legs_eligible then
    raise exception 'Thesis allocation composition is invalid or below market minimums';
  end if;

  select id into revision_id
  from public.thesis_revisions
  where thesis_id = thesis_row.id
  order by revision desc
  limit 1;

  insert into public.thesis_allocations(
    user_id, thesis_id, revision_id, collateral, leverage, status
  )
  values (
    p_user_id, thesis_row.id, revision_id, p_collateral, p_leverage, 'pending'
  )
  returning id into allocation_id;

  insert into public.allocation_legs(
    allocation_id, market_id, direction, entry_weight, target_notional
  )
  select
    allocation_id,
    a.market_id,
    a.direction,
    a.target_weight,
    round(p_collateral * p_leverage * a.target_weight, 10)
  from public.thesis_assets a
  where a.thesis_id = thesis_row.id;

  return jsonb_build_object(
    'allocation_id', allocation_id,
    'status', 'pending',
    'leg_count', asset_count
  );
end
$allocation$;

revoke all on function public.create_thesis_allocation_for_user(uuid, text, numeric, integer)
  from public, anon, authenticated;

grant execute on function public.create_thesis_allocation_for_user(uuid, text, numeric, integer)
  to service_role;
