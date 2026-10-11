
-- Create three Pacifica-testnet narrative markets.
-- Market records are initially inactive until live metadata is synchronized.

insert into public.markets (
  symbol, exchange_id, base_asset, quote_asset, active,
  min_notional, quantity_precision, price_precision,
  min_leverage, max_leverage, metadata_at, metadata
)
values
  ('NVDA', 'NVDA', 'NVDA', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('MU', 'MU', 'MU', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('SKHYNIX', 'SKHYNIX', 'SKHYNIX', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('SAMSUNG', 'SAMSUNG', 'SAMSUNG', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('SNDK', 'SNDK', 'SNDK', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('DRAM', 'DRAM', 'DRAM', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('GOOGL', 'GOOGL', 'GOOGL', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('META', 'META', 'META', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('OPENAI', 'OPENAI', 'OPENAI', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('VVV', 'VVV', 'VVV', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('BTC', 'BTC', 'BTC', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('ETH', 'ETH', 'ETH', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('SOL', 'SOL', 'SOL', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('HYPE', 'HYPE', 'HYPE', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}'),
  ('LINK', 'LINK', 'LINK', 'USD', false, null, 4, 2, 1, 5, null, '{"source":"pacifica-testnet","verified":false}')
on conflict (symbol) do update set
  exchange_id = excluded.exchange_id,
  base_asset = excluded.base_asset,
  quote_asset = excluded.quote_asset,
  active = false,
  min_notional = null,
  metadata_at = null,
  metadata = '{"source":"pacifica-testnet","verified":false}'::jsonb;

insert into public.theses (
  slug, name, category, summary, rationale, horizon, risk_label, status
)
values
  (
    'ai-compute-trade',
    'The AI Compute Trade',
    'Technology',
    'A thesis on demand for AI accelerators and semiconductor memory.',
    'Tracks selected Pacifica testnet markets associated with GPUs, memory and semiconductor infrastructure.',
    'Long term',
    'High',
    'published'
  ),
  (
    'ai-frontier',
    'The AI Frontier',
    'Technology',
    'A thesis spanning AI compute, platforms and related markets.',
    'Tracks selected Pacifica testnet markets associated with AI infrastructure and technology platforms.',
    'Long term',
    'High',
    'published'
  ),
  (
    'crypto-supercycle',
    'The Crypto Supercycle',
    'Crypto',
    'A thesis spanning major crypto assets and ecosystem markets.',
    'Tracks selected Pacifica testnet crypto markets.',
    'Medium term',
    'High',
    'published'
  )
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  summary = excluded.summary,
  rationale = excluded.rationale,
  horizon = excluded.horizon,
  risk_label = excluded.risk_label,
  status = excluded.status,
  updated_at = now();

-- Replace only these three new theses' compositions.
-- All constituents remain inactive until their live metadata is verified.

delete from public.thesis_assets
where thesis_id in (
  select id from public.theses
  where slug in ('ai-compute-trade', 'ai-frontier', 'crypto-supercycle')
);

with composition(slug, symbol, weight) as (
  values
    ('ai-compute-trade', 'NVDA', 0.30),
    ('ai-compute-trade', 'MU', 0.20),
    ('ai-compute-trade', 'SKHYNIX', 0.20),
    ('ai-compute-trade', 'SAMSUNG', 0.15),
    ('ai-compute-trade', 'SNDK', 0.10),
    ('ai-compute-trade', 'DRAM', 0.05),

    ('ai-frontier', 'NVDA', 0.25),
    ('ai-frontier', 'GOOGL', 0.25),
    ('ai-frontier', 'META', 0.20),
    ('ai-frontier', 'OPENAI', 0.15),
    ('ai-frontier', 'VVV', 0.15),

    ('crypto-supercycle', 'BTC', 0.30),
    ('crypto-supercycle', 'ETH', 0.25),
    ('crypto-supercycle', 'SOL', 0.20),
    ('crypto-supercycle', 'HYPE', 0.15),
    ('crypto-supercycle', 'LINK', 0.10)
)
insert into public.thesis_assets (
  thesis_id, market_id, target_weight, direction, rationale
)
select
  t.id,
  m.id,
  c.weight,
  'long',
  'Narrative target allocation; not a trade recommendation.'
from composition c
join public.theses t on t.slug = c.slug
join public.markets m on m.symbol = c.symbol;

