import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/202610100004_thesis_allocation_creation.sql"), "utf8").toLowerCase();
describe("atomic thesis allocation migration contract", () => {
  it("limits creation to authenticated users and supported leverage", () => {
    expect(sql).toContain("if auth.uid() is null");
    expect(sql).toContain("p_leverage not in (2, 3, 5)");
    expect(sql).toContain("from public, anon");
    expect(sql).toContain("to authenticated");
  });
  it("checks published thesis, weight sum, live catalogue state, and market minimums", () => {
    expect(sql).toContain("status = 'published'");
    expect(sql).toContain("total_weight <> 1");
    expect(sql).toContain("m.active and p_leverage <= m.max_leverage");
    expect(sql).toContain("p_collateral * p_leverage * a.target_weight >= coalesce(m.min_notional, 0)");
  });
  it("creates the allocation and all legs in one database function", () => {
    expect(sql).toContain("insert into public.thesis_allocations");
    expect(sql).toContain("insert into public.allocation_legs");
    expect(sql).toContain("round(p_collateral * p_leverage * a.target_weight, 10)");
  });
});
