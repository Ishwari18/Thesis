create table public.phantom_wallet_links (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  address text not null unique,
  verified_at timestamptz not null default now()
);

alter table public.phantom_wallet_links enable row level security;
