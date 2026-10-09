# THESIS

A narrative-first perpetual trading platform prototype. The initial experience uses curated simulated markets, deterministic demo performance, and a no-execution trade preview. It does not place orders or imply the demo portfolio is live.

## Local setup

Requirements: Node.js 20.9+ and pnpm.

1. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from your Supabase project. Demo browsing itself works without credentials.
2. Install and run: `pnpm install`, `pnpm dev`.
3. Open `http://localhost:3000/discover`.

To provision Supabase, apply `supabase/migrations/202610090001_initial_schema.sql` with the Supabase CLI or SQL editor. Demo narratives are currently deterministic application data; the database catalogue seeds canonical market metadata. Generate exact client database types after applying schema with `npm run db:types` (Supabase CLI required). The checked-in types describe the core schema until regenerated.

## Vercel

Import the repository into Vercel and use the default Next.js build settings. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as project environment variables for Preview and Production, then deploy. Configure Supabase Auth Site URL and redirect allowlist to include your local origin and the project's `*.vercel.app` URL; update these when adding a custom domain. No custom domain is required. Never put a service-role key in a `NEXT_PUBLIC_*` variable or browser bundle. No privileged key is needed by the demo.

## Product boundaries

- Search, category filtering, sorting, narrative detail, period controls, allocation preview and per-market minimum checks run against seeded demo providers.
- Trade actions are explicitly demo-only and never call an exchange.
- The STRICT allocation engine uses decimal.js, requires weights to sum to 100%, and checks each leg against its own market minimum. It refuses ineligible legs rather than silently increasing collateral or changing weights.
- Minimum collateral for a leg is `M / (L × w)`. Allocation preview checks demo market minima; a production adapter must fetch active status, fresh market metadata, leverage constraints, precision, fees and margin reserves before eligibility.
- Per-thesis allocation legs remain isolated, including when two theses share a market. Signed position quantity is positive for long and negative for short: unrealized P&L = signed quantity × (mark − entry). Net P&L = realized P&L + unrealized P&L − fees + funding (funding is signed cashflow: positive received, negative paid).
- Database ledger events are append-only for authenticated users. Thesis revisions preserve prior composition snapshots, and allocations retain a revision reference.

## Checks

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` to check the project.

## Pacifica integration still required

Implement authenticated execution, server-side market metadata and pricing providers, idempotent order submission, fill reconciliation, funding/fee ledger ingestion, safe portfolio accounting, and operational risk limits. Validate stale metadata and minimums at execution time. Keep requested order quantities distinct from exchange fills. Add production auth policies, curator provisioning, and audited thesis revision publishing before real user allocations are accepted.
