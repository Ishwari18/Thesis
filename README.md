# THESIS

A narrative-first perpetual trading platform prototype. The initial experience uses curated simulated markets, deterministic demo performance, and a no-execution trade preview. It does not place orders or imply the demo portfolio is live.

## Local setup

Requirements: Node.js 20.9+ and pnpm. On Windows with WSL, open Ubuntu and run:

```bash
cd /mnt/c/Users/user/Documents/ChatGPT/Thesis
pnpm install
pnpm dev
```

Then open `http://localhost:3000/discover` in a Windows browser. If the repo is cloned inside the Linux filesystem instead, use its Linux path (for example `~/src/Thesis`).

Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from your Supabase project. Demo browsing works without credentials. Do not replace an existing `.env.local`; preserve the Supabase values already in it.

To provision Supabase, apply `supabase/migrations/202610090001_initial_schema.sql` and `supabase/migrations/202610090002_pacifica_execution_tracking.sql` with the Supabase CLI or SQL editor. Demo narratives are deterministic application data; the database catalogue seeds canonical market metadata. Generate exact client database types after applying the schema with `npm run db:types` (Supabase CLI required).

## Vercel

Import the repository into Vercel and use the default Next.js build settings. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as project environment variables for Preview and Production, then deploy. Configure Supabase Auth Site URL and redirect allowlist to include your local origin and the project's `*.vercel.app` URL; update these when adding a custom domain. No custom domain is required. Never put a service-role key in a `NEXT_PUBLIC_*` variable or browser bundle. No privileged key is needed by the demo.

## Pacifica testnet

Pacifica integration is restricted to `https://test-api.pacifica.fi`. Market data is off by default; set `PACIFICA_MARKET_DATA_ENABLED=true` to show testnet prices and metadata in the preview. The interface labels this source as Pacifica testnet. If the provider is disabled or unavailable, the preview is explicitly labeled demo-only.

For the optional server-only execution route, configure `PACIFICA_ACCOUNT_ADDRESS`, `PACIFICA_PRIVATE_KEY` (Base58 owner key), and `PACIFICA_ALLOWED_SUPABASE_USER_ID` (the one Supabase user UUID authorized to use the route). Keep `PACIFICA_TESTNET_EXECUTION_ENABLED=false` by default. Never prefix these variables with `NEXT_PUBLIC_`, commit them, or paste them into logs. Execution requires an authenticated matching user and a persisted eligible allocation. The browser never receives signing credentials.

The local `pacifica-kit` and its test report did not verify signed execution against Pacifica: the recorded first info request failed before receiving an HTTP response, and the signed-order scripts were not run. This implementation verifies the documented signing format locally, but no order was sent as part of this integration. The Supabase tracking migration must be applied before the execution route can work. Accepted submissions are not reported as fills; reconciliation and fill, fee, and funding ingestion remain outstanding.

## Product boundaries

- Search, category filtering, sorting, narrative detail and period controls run against seeded demo providers.
- The trade panel can preview Pacifica testnet market metadata and prices, but does not submit orders. The separately gated execution API requires an authenticated allowlisted user and is disabled by default.
- The STRICT allocation engine uses decimal.js, requires weights to sum to 100%, and checks each leg against its own market minimum. It refuses ineligible legs rather than silently increasing collateral or changing weights.
- Minimum collateral for a leg is `M / (L × w)`. Live preview checks fresh testnet metadata, leverage limits, lot size and minimum notional. Fees and margin reserves are not yet modeled.
- Per-thesis allocation legs remain isolated, including when two theses share a market. Signed position quantity is positive for long and negative for short: unrealized P&L = signed quantity × (mark − entry). Net P&L = realized P&L + unrealized P&L − fees + funding (funding is signed cashflow: positive received, negative paid).
- Database ledger events are append-only for authenticated users. Thesis revisions preserve prior composition snapshots, and allocations retain a revision reference.

## Checks

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` to check the project.

## Remaining work

Add exchange fill reconciliation, funding and fee ledger ingestion, operational risk limits, and audited allocation updates after fills. The API currently records submission results and deliberately does not claim fills or update thesis exposure. Review the Supabase RLS policies and apply both migrations before enabling even testnet execution.
