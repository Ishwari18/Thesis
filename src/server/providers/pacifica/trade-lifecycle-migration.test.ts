import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202610120002_thesis_trade_lifecycle.sql"),
  "utf8",
).toLowerCase();

describe("trade lifecycle migration contract", () => {
  it("is transactional and adds idempotent open/close kind metadata", () => {
    expect(migration.trimStart().startsWith("begin;")).toBe(true);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(migration).toContain("add column if not exists idempotency_key uuid");
    expect(migration).toContain("add column if not exists kind text not null default 'open'");
    expect(migration).toContain("check (kind in ('open', 'close'))");
    expect(migration).toContain("unique (user_id, idempotency_key)");
  });

  it("guards every state-changing RPC to service_role and pins search_path", () => {
    const rpcNames = [
      "acquire_pacifica_trade_lock_for_user",
      "create_thesis_allocation_for_user",
      "create_pacifica_execution_intent_for_user",
      "create_pacifica_close_intent_for_user",
      "confirm_pacifica_execution_fills_for_user",
      "resolve_unknown_pacifica_executions_for_user",
      "cancel_unsubmitted_thesis_allocation_for_user",
    ];
    for (const name of rpcNames) {
      const start = migration.indexOf(`function public.${name}`);
      expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
      const next = migration.indexOf("$function$;", start);
      const definition = migration.slice(start, next);
      expect(definition).toContain("set search_path = pg_catalog, public");
      expect(definition).toContain("coalesce(auth.role(), '') <> 'service_role'");
    }
    expect(migration).toContain("to service_role");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("creates short allocations with inverted leg directions and replays the same allocation key", () => {
    expect(migration).toContain("where user_id = p_user_id and idempotency_key = p_idempotency_key");
    expect(migration).toContain("case when p_side = 'short'");
    expect(migration).toContain("'allocation_id', existing_row.id");
  });

  it("creates close intents only for confirmed remaining fills and blocks unresolved legs", () => {
    expect(migration).toContain("e.status in ('pending','submitted','partially_filled','submission_unknown')");
    expect(migration).toContain("where allocation_id = p_allocation_id and filled_quantity > 0");
    expect(migration).toContain("leg_row.filled_quantity - leg_row.closed_quantity");
    expect(migration).toContain("case when leg_row.direction = 'long' then 'sell' else 'buy' end");
  });

  it("applies cumulative fills idempotently and books signed thesis-level close PnL", () => {
    expect(migration).toContain("new_quantity < execution_row.filled_quantity");
    expect(migration).toContain("delta_quantity := new_quantity - execution_row.filled_quantity");
    expect(migration).toContain("case when leg_row.direction = 'long' then 1 else -1 end");
    expect(migration).toContain("realized_pnl = realized_pnl + sign_value * (new_price - leg_row.entry_price) * delta_quantity - open_fee_share - delta_fee");
    expect(migration).toContain("set status = 'closed'");
  });

  it("leaves unknown orders unresolved when no explicit rejection evidence is provided", () => {
    expect(migration).toContain("status = 'submission_unknown'");
    expect(migration).toContain("status = 'rejected'");
    expect(migration).toContain("rejection evidence does not match an unknown order in this batch");
  });

  it("keeps one active trade lock per user even when a duplicate request reuses its key", () => {
    expect(migration).toContain("where public.pacifica_trade_locks.expires_at <= now()");
    expect(migration).not.toContain("or public.pacifica_trade_locks.lock_key = excluded.lock_key");
  });
});
