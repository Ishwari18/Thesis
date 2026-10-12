create table public.thesis_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  thesis_id uuid not null references public.theses(id) on delete cascade,
  captured_at timestamptz not null,
  pnl numeric(30,10) not null,
  realized_pnl numeric(30,10) not null,
  unrealized_pnl numeric(30,10) not null,
  fees numeric(30,10) not null,
  funding numeric(30,10) not null,
  market_data_observed_at timestamptz not null,
  source text not null check (source = 'pacifica-testnet'),
  unique (user_id, thesis_id, captured_at)
);

create index thesis_performance_snapshots_owner_time_idx
  on public.thesis_performance_snapshots (user_id, thesis_id, captured_at desc);

alter table public.thesis_performance_snapshots enable row level security;
revoke all on public.thesis_performance_snapshots from anon, authenticated;
