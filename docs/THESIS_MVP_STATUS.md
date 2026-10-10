# THESIS recovery and MVP status

Audit date: 2026-10-10. Repository used: WSL ~/projects/Thesis.

## What works in the current code

- Supabase sign-up, sign-in, sign-out, email confirmation callback, password reset, and password update flows are implemented and covered by mocked UI/route tests. No email requests were sent as part of this audit.
- Curated thesis discovery and detail pages render, with search/filter controls, narrative text, constituent assets, weights, and an explicitly simulated chart.
- Allocation preview supports 2x, 3x, and 5x and uses Pacifica testnet lot size, minimum notional, leverage, and fresh quote data when the market-data endpoint is enabled.
- Pacifica config is pinned to testnet; market data and testnet execution flags are false in the current ignored local environment file. The file was not modified.
- Server-side Pacifica signing, market/account reads, batch submission, execution-intent persistence, and unknown-outcome protections exist. The execute route does not claim that accepted orders are filled.
- Lint, TypeScript, tests, and the production build pass in WSL. The original suite had 54 tests; five route tests were added for authorization, idempotency, unknown outcomes, and trusted-result persistence.

## What is incomplete or unsafe for an MVP launch

- At audit start, the linked project had both original migrations pending and no public tables, contrary to the prompt's stated migration history. After reviewing and applying the forward migrations, remote history now matches all four local versions and 11 public tables are present.
- Migration 202610100003_pacifica_result_rpc_trust_boundary.sql revokes browser writes to execution/allocation/ledger records, replaces the result RPC with a service-role-only RPC, and validates batch ownership, state, count, client IDs, per-order statuses, and final batch status. Migration 202610100004_thesis_allocation_creation.sql adds an authenticated, atomic allocation-creation RPC. Both were applied and verified remotely.
- Users can save a logical allocation from a published thesis through an authenticated server route and atomic RPC. The portfolio page shows each saved allocation, target legs, collateral, leverage, and THESIS execution states. Saving an allocation never submits an order.
- The chart and activity tabs are demo data. The app does not yet attribute fills, funding, fees, or netted exchange positions to individual theses. Therefore accurate thesis-level live P&L and safe thesis-specific closing are not implemented and must not be inferred from account-level positions.
- Testnet execution remains disabled. The execute route now requires a server-only SUPABASE_SERVICE_ROLE_KEY before persisting or submitting anything; this variable must never use a NEXT_PUBLIC_ prefix. No key was read or added.

## Database migration review

The four migrations recorded by the linked project are:

1. 202610090001_initial_schema.sql: creates profiles, thesis/catalogue, allocation, execution, ledger, and market-price tables; RLS policies and triggers; demo market and thesis seeds.
2. 202610090002_pacifica_execution_tracking.sql: adds execution batches, client order IDs, unresolved-execution constraints, the authenticated owner-checked intent RPC, and the original results RPC.
3. 202610100003_pacifica_result_rpc_trust_boundary.sql: removes direct browser write privileges on executions, allocations, and ledger entries; drops the user-callable result RPC; recreates it for service_role only with strict exact-result validation.
4. 202610100004_thesis_allocation_creation.sql: adds the authenticated allocation-creation RPC with server-side composition and market-catalogue checks.

All four migrations are applied and the remote history matches local. The dry-run was used before each push. Remote checks confirmed 11 public tables, the results RPC exists, only service_role can execute it, and authenticated cannot update executions or insert ledger entries.

## Manual configuration after schema review

- In Supabase Auth, allow the app's local and deployed callback URLs (/auth/callback) and confirm email/password auth and reset email delivery settings. The reset email callback continues to /auth/update-password.
- In the server environment, for example Vercel project environment settings, set SUPABASE_SERVICE_ROLE_KEY as a private server variable. Never expose it to browser code or use a NEXT_PUBLIC_ name. Do not add it to a committed file.
- Keep PACIFICA_MARKET_DATA_ENABLED=false and PACIFICA_TESTNET_EXECUTION_ENABLED=false until private server configuration is complete and a separate controlled testnet validation is authorized. Mainnet execution is not supported by this integration.

## Priority next steps

1. Validate allocation creation and portfolio reads with an already-confirmed Supabase test account; no signup emails were triggered in this audit.
2. Build fill/funding reconciliation keyed to persisted client order IDs before displaying personal thesis P&L.
3. Only consider thesis closing after the exchange/account model can reliably attribute exposure to a thesis. Current positions are netted by symbol and are not thesis-attributable.
4. Configure the service-role key in a private server environment, then run a controlled testnet flow only after explicit approval. Keep mainnet and real orders out of scope.
