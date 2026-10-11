# THESIS Pacifica trading E2E report

**Run status:** local implementation and mocked tests complete; Pacifica testnet trading and Supabase migration application were not run. The testnet account was not accessed, so this report makes no claims about live fills, prices, leverage behavior, or order acceptance.

## Root causes and changes

| Problem | Root cause | Change |
| --- | --- | --- |
| P1: submitted orders never became filled | The existing lifecycle recorded submission results but did not reconcile Pacifica `trades/history` into execution fills and allocation legs. | Added durable per-order intent, fill confirmation, fee and entry accounting, portfolio reconciliation, and close-fill P&L. Matching is by client order ID; unknown orders are never resent. |
| P2: orphan allocations | Allocation creation and execution were separate browser calls. Validation failures and total rejection could leave a pending allocation. | The new server open route owns validation, allocation creation, intent persistence, and submission. Pre-submit failures and total rejection use a service-only cancellation RPC; partial successes stay open. The old two routes are retired with explicit 410 responses. |
| P3: browser orchestration | The browser could stop between saving an allocation and submitting its orders. | The UI now makes one server request after its review/confirm step. The server persists intent before contacting Pacifica. |
| P4: duplicate migration version | `202610110001_pacifica_narrative_markets.sql` and `202610110001_thesis_allocation_privy.sql` use the same version. | Neither historical file was edited. The new migration is `202610120002_thesis_trade_lifecycle.sql`. Before resuming CLI migrations, an operator should compare both files with each environment's migration ledger and resolve the duplicate without changing an already-applied migration or using `migration repair`. |
| P5: allocation sizing test | The fixture used one asset at 100% weight, $100 collateral, and 2x leverage, which correctly targets $200 notional; its assertions described $50 notional. | Corrected the fixture collateral to $25 so it tests the asserted $50 target. Kept the sizing behavior and assertions. Also fixed stale-market preview errors to report the actual reason. |
| P6: route tests used old auth mocks | The allocations and execute route tests mocked the former Supabase login path, while the routes use `getAppUser`. | Updated route behavior and tests around the current Privy-backed auth helper. Those legacy routes now reject the old two-call flow cleanly. |

## Requirement status and evidence

“Done” below means the code and local/mock evidence exist. It does not mean the SQL is deployed or Pacifica behavior was verified live.

| Requirement | Status | Evidence / remaining work |
| --- | --- | --- |
| 1.1 Fill confirmation RPC, ownership, service role, search path, idempotent cumulative totals | Done in code; deployment unverified | New migration plus static SQL contract tests; no database execution. |
| 1.2 Open/close kinds and exact remaining close intents | Done in code; deployment unverified | Migration and route tests verify opposite side, remaining quantity, and reduce-only submission. |
| 1.3 Close-fill fees, realized P&L, close only when fully exited | Done in code; deployment unverified | SQL contract and long/short fee-inclusive P&L unit tests. |
| 1.4 Unknown outcome resolution | Partial | Trade history confirms fills by `client_order_id`; unknown orders without positive fill/rejection evidence remain unknown. No unsupported inference of rejection is made. |
| 1.5 Cancel never-submitted allocations | Done in code; deployment unverified | Service-only RPC and open-route pre-submit cancellation test. |
| 1.6 Migration security/idempotency tests | Done | Static migration tests cover transaction, grants, service-role checks, pinned search path, idempotency, side inversion, close quantity, and P&L. |
| 2.1 Server-side open, cancellation, partial outcomes, idempotency | Done in code; live behavior unverified | Open-route tests cover long/short, balance, minimum, cap, netting, pre-submit cancel, partial rejection, unknown replay, and auth. |
| 2.2 Bounded fill reconciliation | Partial | Open/close perform two bounded history reads and leave missing fills reconcilable. Actual Pacifica history latency is unverified. |
| 2.3 Authenticated reduce-only close | Done in code; live behavior unverified | Close-route tests cover side, exact size, shared-symbol positions, smaller exchange position, already-closed thesis, and unknown outcomes. |
| 2.4 Portfolio reconciliation action | Partial | Route verifies allocation ownership and reconciles fills. Unknowns without exchange evidence remain unresolved; live results unverified. |
| 2.5 Live leverage cap and implied leverage check | Partial | UI and server use the lowest live market cap; server checks existing symbol leverage before orders and reports implied leverage when margin delta is available. 2x/3x/5x were not exercised live. |
| 2.6 Opposite-side netting guard | Done in code; live behavior unverified | Server route tests block an opposing Pacifica position before creating an allocation. |
| 2.7 P5/P6 fixes | Done | Corrected fixture and current auth mocks; tests pass. |
| 3.1 Trade panel | Done in code; live behavior unverified | Testnet labels, fresh-data gating, leverage cap, minimum collateral, review step, auth messages, per-leg statuses, and unknown-state messaging. |
| 3.2 Per-thesis Portfolio and live marks | Done in code; live behavior unverified | Own-leg quantities and P&L are calculated from allocation records. Missing/stale marks display as an em dash. Exchange positions are labeled as net positions across theses. |
| 3.3 Close UI and history | Partial | Confirmation shows exact reduce-only quantities and displays per-leg close results. Fully filled partial exits remain open. A provider-side partial execution stays unresolved until its remainder is explicitly resolved; the current integration has no order-cancel/remainder-rejection evidence path. |
| 3.4 Loading/empty/error states | Done in code | Trade and portfolio views include loading, empty, inline status, and error states. |
| Unit tests | Done | `pnpm test`: 101 passed, 1 skipped (the opt-in testnet E2E). |
| Testnet E2E | Not run | `src/server/providers/pacifica/trading.e2e.test.ts` is skipped unless `RUN_TESTNET_E2E=1`; it refuses non-testnet hosts and attempts cleanup on failure. No testnet credentials or live evidence were used here. |

## U1–U6: live testnet findings

All six are **NOT VERIFIED: no Pacifica testnet request/response was captured in this run**. The user-supplied brief includes prior observations, but they were not re-run here and are not treated as evidence for this implementation.

| Question | Status |
| --- | --- |
| U1: Does a valid batch leg remain open when another leg is rejected? | NOT VERIFIED: no Pacifica testnet request/response captured. |
| U2: Is a reduce-only close below $10 accepted? | NOT VERIFIED: no Pacifica testnet request/response captured. |
| U3: Can leverage change while a position is open, both higher and lower? | NOT VERIFIED: no Pacifica testnet request/response captured. |
| U4: Is a 5,000 ms signature expiry reliable from this machine? | NOT VERIFIED: no Pacifica testnet request/response captured. The existing signing default remains unchanged. |
| U5: Are equity-perp prices fresh on weekends, and does META accept market orders? | NOT VERIFIED: no Pacifica testnet request/response captured. |
| U6: How long do fills take to appear in trade history? | NOT VERIFIED: no Pacifica testnet request/response captured. Reconciliation uses two bounded reads; the delay needs measurement. |

## Migration application and rollback

Apply **only after** confirming the base schema and prior RPCs are already present in the target Supabase database:

1. `supabase/migrations/202610120002_thesis_trade_lifecycle.sql` — paste/run this complete file in the Supabase SQL Editor as one transaction.

Do not run `supabase db push`, `supabase db reset`, or migration repair. The two `202610110001` files create an ambiguous CLI history. Before using CLI migration tracking again, inspect the ledger and database state, then have the migration owner choose a unique history for any unapplied file; do not rewrite an applied migration or silently mark a migration applied.

Before rollback, stop trading, reconcile all unknown executions, close or otherwise account for open testnet exposure, and take a database backup. The migration adds columns, constraints, a lock table, and RPCs. A rollback would need to remove those RPCs and table and undo constraints/columns only after confirming no application version depends on them. Dropping fill/close accounting columns loses evidence and can damage auditability; preserve/export those records first. No rollback SQL was run or applied.

## Manual verification checklist

### Pacifica testnet

1. Use a dedicated testnet account with no existing positions, enable only the testnet configuration, and confirm the displayed market data is fresh. Keep adequate free testnet collateral for fees and margin.
2. On the cheapest eligible thesis, choose minimum collateral and 2x. Review the basket, confirm a long, then wait for confirmed per-leg fills in Portfolio. Compare each market, direction, quantity, and entry with Pacifica.
3. Close the thesis from Portfolio. Confirm the dialog shows exact remaining quantities and reduce-only orders. Verify fills, realized P&L, and that the exchange account is flat.
4. Repeat with a short. Confirm every leg direction is reversed, compare sizes and sides, close, and verify flat again.
5. Separately test 3x and 5x only on theses whose live maximum leverage allows them. Check the reported implied leverage against Pacifica margin used.
6. Exercise U1–U6 individually and save each raw request/response with timestamps and testnet account context. Do not repeat an order after an unknown result; reconcile it first.

### Supabase SQL Editor

Replace the UUID literal with the configured test user's Supabase ID. These are read-only inspection queries:

```sql
select id, thesis_id, collateral, leverage, side, status, created_at, closed_at
from public.thesis_allocations
where user_id = '00000000-0000-4000-8000-000000000000'
order by created_at desc;

select a.id as allocation_id, m.symbol, l.direction, l.entry_weight,
       l.requested_quantity, l.filled_quantity, l.entry_price,
       l.actual_notional, l.realized_pnl, l.fees
from public.thesis_allocations a
join public.allocation_legs l on l.allocation_id = a.id
join public.markets m on m.id = l.market_id
where a.user_id = '00000000-0000-4000-8000-000000000000'
order by a.created_at desc, m.symbol;

select a.id as allocation_id, b.id as batch_id, b.kind as batch_kind,
       b.status as batch_status, e.client_order_id, e.side, e.status,
       e.requested_quantity, e.filled_quantity, e.average_fill_price,
       e.fee, e.provider_error
from public.thesis_allocations a
join public.allocation_legs l on l.allocation_id = a.id
join public.executions e on e.allocation_leg_id = l.id
join public.pacifica_execution_batches b on b.id = e.batch_id
where a.user_id = '00000000-0000-4000-8000-000000000000'
order by b.created_at desc, e.created_at;
```

Verify open and closed allocation records against Pacifica trade history and positions. A closed thesis should have no remaining thesis quantity; the account should be flat after the test sequence.

## Limitations and decisions

- No live testnet account was used, and the migration is not applied. Real order behavior remains unverified.
- Testnet E2E assumes the configured account is flat before starting. It prints sanitized order/position evidence and attempts to reconcile and close allocations if a later assertion fails. If Pacifica leaves an order unknown, safe cleanup may require a human to inspect the exchange before any further action.
- An unknown submission is never retried. A matching trade-history fill confirms it; absence of history does not prove rejection. No exchange cancellation endpoint is integrated, so partial execution remainder handling may require human reconciliation before another close can be sent.
- Partial basket opens are kept open as requested. The code does not automatically roll back confirmed legs; the user must review and close them from Portfolio.
- U1–U6 require a human-controlled testnet session and raw response capture before the E2E behavior can be called verified.
