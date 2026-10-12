-- Record the per-user Pacifica trade-only agent key that the linked wallet approved.
-- The private key is derived on the server from PACIFICA_AGENT_KEY_SECRET and is
-- never stored in the database or returned to the browser.
create table if not exists public.pacifica_agent_wallet_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_address text not null,
  agent_address text not null unique,
  created_at timestamptz not null default now()
);

alter table public.pacifica_agent_wallet_links enable row level security;
revoke all on table public.pacifica_agent_wallet_links from anon, authenticated, public;
grant all on table public.pacifica_agent_wallet_links to service_role;
