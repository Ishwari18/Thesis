-- Map a verified Privy identity to its app-owned Supabase user.
-- Access is restricted to server-side service-role code.

create table if not exists public.privy_links (
  privy_id text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.privy_links enable row level security;
revoke all on public.privy_links from anon, authenticated;
grant all on public.privy_links to service_role;

-- This identity mapping must not be exposed through client-side RLS policies,
-- including policies left behind by an earlier manual setup.
do $policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'privy_links'
  loop
    execute format('drop policy if exists %I on public.privy_links', policy_row.policyname);
  end loop;
end
$policies$;
