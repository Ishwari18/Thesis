import { afterEach, describe, expect, it, vi } from "vitest";

const enabled = process.env.RUN_TESTNET_E2E === "1";

vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return {
    ...actual,
    getAppUser: async () => {
      const { readPacificaConfig } = await import("./config");
      const userId = readPacificaConfig().allowedUserId;
      return userId ? { userId } : null;
    },
  };
});

const createdAllocations: string[] = [];

afterEach(() => { createdAllocations.length = 0; });

describe.skipIf(!enabled)("Pacifica testnet trading E2E", () => {
  it("opens long and short baskets, reconciles fills, closes them, and prints sanitized evidence", async () => {
    const [{ readPacificaConfig, requireExecutionConfig, TESTNET_URL }, { adminClient }, { listTheses }, { fetchPacificaSnapshot }, { getPacificaPositions }, { minimumCollateral, previewAllocation }, { POST: openTrade }, { POST: closeTrade }, { POST: reconcileTrade }] = await Promise.all([
      import("./config"),
      import("@/lib/auth/server"),
      import("@/server/services/theses/service"),
      import("./market-data"),
      import("./positions"),
      import("@/server/services/allocation"),
      import("@/app/api/trade/open/route"),
      import("@/app/api/trade/close/route"),
      import("@/app/api/trade/reconcile/route"),
    ]);
    const config = requireExecutionConfig(readPacificaConfig());
    if (config.baseUrl !== TESTNET_URL || config.baseUrl !== "https://test-api.pacifica.fi") {
      throw new Error("Refusing E2E execution: only the Pacifica testnet host is permitted.");
    }
    const userId = config.allowedUserId;
    const db = adminClient();
    const assertFlat = async () => {
      const positions = await getPacificaPositions();
      expect(positions, "Pacifica testnet account must be flat before and after each cycle").toEqual([]);
    };
    await assertFlat();

    const snapshot = await fetchPacificaSnapshot();
    const theses = await listTheses();
    const candidates = theses.flatMap((thesis) => {
      if (!thesis.assets.length) return [];
      const minimum = Math.max(...thesis.assets.map((asset) => Number(minimumCollateral(
        snapshot.markets.find((market) => market.symbol === asset.symbol)?.minNotional ?? asset.minNotional,
        2,
        asset.weight,
      ))));
      const minimumNumber = Number(minimum);
      if (!Number.isFinite(minimumNumber)) return [];
      for (let cents = 0; cents < 10_000; cents++) {
        const collateral = (minimumNumber + cents / 100).toFixed(2);
        if (previewAllocation(thesis, collateral, 2, { ...snapshot, source: "pacifica-testnet" }).valid) {
          return [{ thesis, collateral: Number(collateral) }];
        }
      }
      return [];
    }).sort((a, b) => a.collateral - b.collateral);
    const candidate = candidates[0];
    if (!candidate) throw new Error("No published thesis can be sized at current testnet minimums.");

    const evidence: Array<Record<string, unknown>> = [];
    const invoke = async (handler: (request: Request) => Promise<Response>, body: unknown) => {
      const response = await handler(new Request("http://localhost/api/trade", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }));
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    const reconcileUntilSettled = async (allocationId: string) => {
      let last: { status: number; body: Record<string, any> } | undefined;
      for (let attempt = 0; attempt < 8; attempt++) {
        last = await invoke(reconcileTrade, { allocationId });
        if (last.status < 300 && !last.body.needsReconciliation && !(last.body.unresolvedClientOrderIds?.length)) return last;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new Error(`Testnet trade history did not settle for allocation ${allocationId}: ${JSON.stringify(last?.body)}`);
    };
    const closeAllocation = async (allocationId: string) => {
      const response = await invoke(closeTrade, { allocationId, idempotencyKey: crypto.randomUUID() });
      evidence.push({ action: "close", allocationId, status: response.status, response: response.body });
      if (response.status >= 300 && response.status !== 202) throw new Error(`Close failed for ${allocationId}: ${JSON.stringify(response.body)}`);
      await reconcileUntilSettled(allocationId);
      const { data, error } = await db.from("thesis_allocations").select("status").eq("id", allocationId).eq("user_id", userId).single();
      if (error) throw new Error(`Unable to verify closed allocation ${allocationId}.`);
      expect(data.status).toBe("closed");
      await assertFlat();
    };

    try {
      for (const side of ["long", "short"] as const) {
        const opened = await invoke(openTrade, {
          thesisSlug: candidate.thesis.slug,
          collateral: candidate.collateral.toFixed(2),
          leverage: 2,
          side,
          idempotencyKey: crypto.randomUUID(),
        });
        evidence.push({ action: "open", side, thesisSlug: candidate.thesis.slug, collateral: candidate.collateral.toFixed(2), status: opened.status, response: opened.body });
        if (opened.status >= 300 || !opened.body.allocationId) throw new Error(`Testnet ${side} open failed: ${JSON.stringify(opened.body)}`);
        const allocationId = String(opened.body.allocationId);
        createdAllocations.push(allocationId);
        await reconcileUntilSettled(allocationId);

        const { data: legs, error } = await db.from("allocation_legs").select("id,market_id,direction,filled_quantity,entry_price").eq("allocation_id", allocationId);
        if (error || !legs?.length || legs.some((leg: any) => Number(leg.filled_quantity) <= 0 || !leg.entry_price)) {
          throw new Error(`DB legs do not show confirmed fills for ${allocationId}.`);
        }
        const marketIds = legs.map((leg: any) => leg.market_id);
        const { data: markets, error: marketError } = await db.from("markets").select("id,symbol").in("id", marketIds);
        if (marketError) throw new Error("Unable to load markets to compare Pacifica positions.");
        const symbolById = new Map(markets.map((market: any) => [market.id, market.symbol]));
        const positions = await getPacificaPositions();
        for (const leg of legs) {
          const position = positions.find((row) => row.symbol === symbolById.get(leg.market_id));
          expect(position, `Pacifica position missing for ${symbolById.get(leg.market_id)}`).toBeTruthy();
          expect(position!.direction).toBe(leg.direction);
          expect(Number(position!.quantity)).toBeCloseTo(Number(leg.filled_quantity), 6);
        }
        evidence.push({ action: "compare", allocationId, databaseLegs: legs.map((leg: any) => ({ symbol: symbolById.get(leg.market_id), direction: leg.direction, quantity: leg.filled_quantity, entryPrice: leg.entry_price })), pacificaPositions: positions.map((position) => ({ symbol: position.symbol, direction: position.direction, quantity: position.quantity })) });
        await closeAllocation(allocationId);
      }
    } catch (error) {
      for (const allocationId of createdAllocations.reverse()) {
        try {
          await reconcileUntilSettled(allocationId);
          const { data } = await db.from("thesis_allocations").select("status").eq("id", allocationId).eq("user_id", userId).maybeSingle();
          if (data?.status === "open") await closeAllocation(allocationId);
        } catch (cleanupError) {
          evidence.push({ action: "cleanup_failed", allocationId, detail: cleanupError instanceof Error ? cleanupError.message : "unknown cleanup error" });
        }
      }
      console.info("[pacifica-testnet-e2e] sanitized evidence", JSON.stringify(evidence));
      throw error;
    }
    await assertFlat();
    console.info("[pacifica-testnet-e2e] sanitized evidence", JSON.stringify(evidence));
  }, 180_000);
});
