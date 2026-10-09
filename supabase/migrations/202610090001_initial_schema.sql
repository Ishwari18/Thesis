create extension if not exists pgcrypto;
create type public.profile_role as enum ('user','curator');
create type public.thesis_status as enum ('draft','published','archived');
create type public.position_direction as enum ('long','short');

create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role public.profile_role not null default 'user', display_name text, created_at timestamptz not null default now());
create table public.theses (id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null, category text not null, summary text not null, rationale text not null, horizon text, risk_label text, artwork_url text, status public.thesis_status not null default 'draft', created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.markets (id uuid primary key default gen_random_uuid(), symbol text not null unique, exchange_id text not null, base_asset text not null, quote_asset text not null, active boolean not null default true, min_notional numeric(30,10), quantity_precision smallint not null, price_precision smallint not null, min_leverage numeric(8,4) not null default 1, max_leverage numeric(8,4) not null, metadata_at timestamptz, metadata jsonb not null default '{}');
create table public.thesis_assets (id uuid primary key default gen_random_uuid(), thesis_id uuid not null references public.theses(id) on delete cascade, market_id uuid not null references public.markets(id), target_weight numeric(12,10) not null check(target_weight > 0 and target_weight <= 1), direction public.position_direction not null default 'long', rationale text, unique(thesis_id,market_id));
create table public.thesis_revisions (id uuid primary key default gen_random_uuid(), thesis_id uuid not null references public.theses(id), revision integer not null, snapshot jsonb not null, published_at timestamptz not null default now(), unique(thesis_id,revision));
create table public.thesis_allocations (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), thesis_id uuid not null references public.theses(id), revision_id uuid references public.thesis_revisions(id), collateral numeric(30,10) not null check(collateral > 0), leverage numeric(8,4) not null check(leverage >= 1), status text not null default 'pending' check(status in ('pending','open','closed','cancelled')), created_at timestamptz not null default now(), closed_at timestamptz);
create index thesis_allocations_user_idx on public.thesis_allocations(user_id,created_at desc);
create table public.allocation_legs (id uuid primary key default gen_random_uuid(), allocation_id uuid not null references public.thesis_allocations(id), market_id uuid not null references public.markets(id), direction public.position_direction not null, entry_weight numeric(12,10) not null check(entry_weight > 0), target_notional numeric(30,10) not null default 0, actual_notional numeric(30,10) not null default 0, requested_quantity numeric(30,12) not null default 0, filled_quantity numeric(30,12) not null default 0, entry_price numeric(30,12), realized_pnl numeric(30,10) not null default 0, fees numeric(30,10) not null default 0, funding numeric(30,10) not null default 0, created_at timestamptz not null default now(), unique(allocation_id,market_id));
create index allocation_legs_allocation_idx on public.allocation_legs(allocation_id);
create table public.executions (id uuid primary key default gen_random_uuid(), allocation_leg_id uuid not null references public.allocation_legs(id), requested_quantity numeric(30,12) not null, filled_quantity numeric(30,12) not null default 0, side text not null check(side in ('buy','sell')), status text not null check(status in ('pending','submitted','partially_filled','filled','cancelled','rejected')), average_fill_price numeric(30,12), fee numeric(30,10) not null default 0, external_id text, created_at timestamptz not null default now());
create table public.ledger_entries (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), allocation_id uuid not null references public.thesis_allocations(id), allocation_leg_id uuid references public.allocation_legs(id), execution_id uuid references public.executions(id), event_type text not null check(event_type in ('allocation','fill','fee','funding','realized_pnl','collateral_return')), amount numeric(30,10) not null, currency text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now());
create index ledger_entries_allocation_idx on public.ledger_entries(allocation_id,created_at);
create table public.market_price_snapshots (id uuid primary key default gen_random_uuid(), market_id uuid not null references public.markets(id), observed_at timestamptz not null, price numeric(30,12) not null check(price > 0), source text not null, demo boolean not null default false, unique(market_id,observed_at,source));

create or replace function public.is_curator() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='curator') $$;
-- Deferrable validation allows composition weights to be edited in one transaction.
create or replace function public.validate_thesis_weights() returns trigger language plpgsql as $$ declare target uuid; total numeric; begin target := coalesce(new.thesis_id,old.thesis_id); select coalesce(sum(target_weight),0) into total from public.thesis_assets where thesis_id=target; if total <> 1 then raise exception 'Thesis weights must sum to 1'; end if; return null; end $$;
create constraint trigger thesis_assets_weight_sum after insert or update or delete on public.thesis_assets deferrable initially deferred for each row execute function public.validate_thesis_weights();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id,display_name) values(new.id,new.raw_user_meta_data->>'name'); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.theses enable row level security;
alter table public.markets enable row level security;
alter table public.thesis_assets enable row level security;
alter table public.thesis_revisions enable row level security;
alter table public.thesis_allocations enable row level security;
alter table public.allocation_legs enable row level security;
alter table public.executions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.market_price_snapshots enable row level security;
create policy "profiles read self or curator" on public.profiles for select using(id=auth.uid() or public.is_curator());
create policy "profiles update self" on public.profiles for update using(id=auth.uid()) with check(id=auth.uid() and role='user');
create policy "published theses visible" on public.theses for select using(status='published' or created_by=auth.uid() or public.is_curator());
create policy "curators manage theses" on public.theses for all using(public.is_curator()) with check(public.is_curator());
create policy "markets visible to authenticated and anon" on public.markets for select using(true);
create policy "curators manage markets" on public.markets for all using(public.is_curator()) with check(public.is_curator());
create policy "thesis assets visible for published" on public.thesis_assets for select using(exists(select 1 from public.theses t where t.id=thesis_id and (t.status='published' or public.is_curator())));
create policy "curators manage thesis assets" on public.thesis_assets for all using(public.is_curator()) with check(public.is_curator());
create policy "published revisions visible" on public.thesis_revisions for select using(exists(select 1 from public.theses t where t.id=thesis_id and (t.status='published' or public.is_curator())));
create policy "curators manage revisions" on public.thesis_revisions for all using(public.is_curator()) with check(public.is_curator());
create policy "allocations own records" on public.thesis_allocations for all using(user_id=auth.uid() or public.is_curator()) with check(user_id=auth.uid() or public.is_curator());
create policy "legs own allocations" on public.allocation_legs for all using(exists(select 1 from public.thesis_allocations a where a.id=allocation_id and (a.user_id=auth.uid() or public.is_curator()))) with check(exists(select 1 from public.thesis_allocations a where a.id=allocation_id and (a.user_id=auth.uid() or public.is_curator())));
create policy "executions own legs" on public.executions for all using(exists(select 1 from public.allocation_legs l join public.thesis_allocations a on a.id=l.allocation_id where l.id=allocation_leg_id and (a.user_id=auth.uid() or public.is_curator()))) with check(exists(select 1 from public.allocation_legs l join public.thesis_allocations a on a.id=l.allocation_id where l.id=allocation_leg_id and (a.user_id=auth.uid() or public.is_curator())));
create policy "ledger own records" on public.ledger_entries for all using(user_id=auth.uid() or public.is_curator()) with check(user_id=auth.uid() or public.is_curator());
create policy "prices visible" on public.market_price_snapshots for select using(true);
create policy "curators manage prices" on public.market_price_snapshots for all using(public.is_curator()) with check(public.is_curator());
revoke update, delete on public.ledger_entries from authenticated;

insert into public.markets(symbol,exchange_id,base_asset,quote_asset,active,min_notional,quantity_precision,price_precision,max_leverage,metadata_at,metadata) values
('NVDA','demo:NVDA','NVDA','USD',true,10,4,2,5,now(),'{}'),('AMD','demo:AMD','AMD','USD',true,10,4,2,5,now(),'{}'),('AVGO','demo:AVGO','AVGO','USD',true,10,4,2,5,now(),'{}'),('TSM','demo:TSM','TSM','USD',true,10,4,2,5,now(),'{}'),('TSLA','demo:TSLA','TSLA','USD',true,10,4,2,5,now(),'{}'),('COIN','demo:COIN','COIN','USD',true,10,4,2,5,now(),'{}'),('ROKU','demo:ROKU','ROKU','USD',true,10,4,2,5,now(),'{}'),('AAPL','demo:AAPL','AAPL','USD',true,10,4,2,5,now(),'{}'),('MSFT','demo:MSFT','MSFT','USD',true,10,4,2,5,now(),'{}'),('AMZN','demo:AMZN','AMZN','USD',true,10,4,2,5,now(),'{}'),('HOOD','demo:HOOD','HOOD','USD',true,10,4,2,5,now(),'{}'),('MSTR','demo:MSTR','MSTR','USD',true,10,4,2,5,now(),'{}'),('BTC','demo:BTC','BTC','USD',true,10,4,2,5,now(),'{}'),('ETH','demo:ETH','ETH','USD',true,10,4,2,5,now(),'{}'),('SOL','demo:SOL','SOL','USD',true,10,4,2,5,now(),'{}') on conflict(symbol) do nothing;

update public.markets set min_notional=case symbol when 'AMD' then 12 when 'AVGO' then 15 when 'COIN' then 20 when 'ROKU' then 12 when 'AMZN' then 12 when 'MSTR' then 15 else 10 end where exchange_id like 'demo:%';
-- Demo portfolios in src/server/services/theses/demo.ts are deliberately separate from authenticated account data.
-- Each user thesis_allocation owns its own allocation_legs, so shared symbols never merge across theses.
insert into public.theses(slug,name,category,summary,rationale,horizon,risk_label,status) values
('ai-infrastructure','AI Infrastructure','Technology','The compute, chips and infrastructure behind the next wave of AI.','AI adoption needs more than clever software. It depends on a deep stack of compute, networking and semiconductor capacity. This illustrative thesis follows selected companies across that stack.','Long term','Elevated','published'),
('the-ark-index','The ARK Index','Growth','A high-conviction basket across disruptive growth themes.','A concentrated basket of growth-oriented companies selected for exposure to long-term technology shifts. This independently configured thesis does not replicate a fund or public portfolio.','Long term','High','published'),
('semiconductor-leaders','Semiconductor Leaders','Technology','The companies building the world’s most advanced chips.','Semiconductor demand spans design, manufacturing and accelerated computing. This basket groups large companies across those parts of the supply chain.','Long term','Elevated','published'),
('the-magnificent-seven','The Magnificent Seven','Technology','A focused look at large technology leaders.','A concentrated group of widely followed technology businesses, selected for scale and broad product ecosystems.','Long term','Elevated','published'),
('onchain-finance','Onchain Finance','Crypto','A basket spanning access, infrastructure and digital assets.','Financial access and crypto infrastructure are evolving alongside digital assets. This basket represents selected companies associated with that activity.','Medium term','High','published'),
('decentralized-ai','Decentralized AI','Crypto','The intersection of machine intelligence and open networks.','This thesis explores public companies connected to compute and crypto infrastructure that may intersect with decentralized AI development.','Long term','High','published'),
('crypto-majors','Crypto Majors','Crypto','A broad, liquid starting point for digital asset exposure.','A simple multi-asset basket of established digital asset markets, with weights configured for this demo.','Long term','High','published'),
('consumer-crypto-recovery','Consumer Crypto Recovery','Consumer','A speculative basket around a potential consumer cycle turn.','A speculative group of consumer-facing platforms with potential exposure to renewed retail interest.','Speculative','High','published') on conflict(slug) do nothing;
with composition(slug,symbol,weight) as (values
('ai-infrastructure','NVDA',.45),('ai-infrastructure','AMD',.30),('ai-infrastructure','AVGO',.25),
('the-ark-index','TSLA',.35),('the-ark-index','COIN',.35),('the-ark-index','ROKU',.30),
('semiconductor-leaders','NVDA',.35),('semiconductor-leaders','AMD',.25),('semiconductor-leaders','AVGO',.20),('semiconductor-leaders','TSM',.20),
('the-magnificent-seven','AAPL',.25),('the-magnificent-seven','MSFT',.25),('the-magnificent-seven','NVDA',.20),('the-magnificent-seven','AMZN',.30),
('onchain-finance','COIN',.40),('onchain-finance','HOOD',.35),('onchain-finance','MSTR',.25),
('decentralized-ai','NVDA',.40),('decentralized-ai','AMD',.35),('decentralized-ai','COIN',.25),
('crypto-majors','BTC',.50),('crypto-majors','ETH',.30),('crypto-majors','SOL',.20),
('consumer-crypto-recovery','HOOD',.40),('consumer-crypto-recovery','COIN',.35),('consumer-crypto-recovery','TSLA',.25))
insert into public.thesis_assets(thesis_id,market_id,target_weight,direction,rationale)
select t.id,m.id,c.weight,'long','Illustrative demo target' from composition c join public.theses t on t.slug=c.slug join public.markets m on m.symbol=c.symbol
on conflict(thesis_id,market_id) do nothing;
insert into public.thesis_revisions(thesis_id,revision,snapshot)
select t.id,1,jsonb_build_object('name',t.name,'summary',t.summary,'rationale',t.rationale,'assets',coalesce(jsonb_agg(jsonb_build_object('symbol',m.symbol,'weight',a.target_weight,'direction',a.direction)) filter(where a.id is not null),'[]'::jsonb)) from public.theses t left join public.thesis_assets a on a.thesis_id=t.id left join public.markets m on m.id=a.market_id group by t.id on conflict(thesis_id,revision) do nothing;
