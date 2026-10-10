import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202610100003_pacifica_result_rpc_trust_boundary.sql"), "utf8").toLowerCase();

describe("Pacifica execution security migration contract", () => {
  it("removes authenticated access to the old results RPC and grants only the trusted role", () => {
    expect(migration).toContain("drop function if exists public.record_pacifica_execution_results(uuid,text,text,jsonb)");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.record_pacifica_execution_results(uuid,uuid,text,text,jsonb)");
    expect(migration).toContain("to service_role");
  });

  it("makes exchange executions and accounting records read-only to browser roles", () => {
    for (const table of ["executions", "allocation_legs", "thesis_allocations", "ledger_entries"]) {
      expect(migration).toContain("revoke all on table public." + table + " from anon, authenticated");
      expect(migration).toContain("grant select on table public." + table + " to authenticated");
    }
  });

  it("requires the service role and binds reconciliation to an explicit batch owner", () => {
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain("where id = p_batch_id and user_id = p_user_id");
    expect(migration).toContain("if batch_row.status <> 'pending'");
  });

  it("requires exact per-order results and rejects duplicate or unexpected client IDs", () => {
    expect(migration).toContain("jsonb_array_length(p_results) <> expected_count");
    expect(migration).toContain("where batch_id = p_batch_id and client_order_id = client_id and status = 'pending'");
    expect(migration).toContain("if changed_count <> 1 then");
    expect(migration).toContain("execution result is duplicate or does not belong to this batch");
  });

  it("keeps unknown outcomes unresolved and validates aggregate status", () => {
    expect(migration).toContain("unknown submissions cannot include per-order results");
    expect(migration).toContain("set status = 'submission_unknown'");
    expect(migration).toContain("if p_status <> expected_status then");
  });
});
