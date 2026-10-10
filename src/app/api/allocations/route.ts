import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type AllocationRpcClient = {
  rpc: (name: "create_thesis_allocation", args: { p_thesis_slug: string; p_collateral: number; p_leverage: 2 | 3 | 5 }) => Promise<{ data: unknown; error: unknown | null }>;
};
const inputSchema = z.object({
  thesisSlug: z.string().regex(/^[a-z0-9-]{1,100}$/),
  collateral: z.string().regex(/^\d+(\.\d{1,2})?$/).refine(value => Number.isSafeInteger(Number(value) * 100)),
  leverage: z.union([z.literal(2), z.literal(3), z.literal(5)]),
});
const resultSchema = z.object({ allocation_id: z.string().uuid(), status: z.literal("pending"), leg_count: z.number().int().min(1).max(10) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to save an allocation." }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid collateral amount and choose 2x, 3x, or 5x." }, { status: 400 });

  const { data, error } = await (supabase as unknown as AllocationRpcClient).rpc("create_thesis_allocation", {
    p_thesis_slug: parsed.data.thesisSlug,
    p_collateral: Number(parsed.data.collateral),
    p_leverage: parsed.data.leverage,
  });
  if (error) return NextResponse.json({ error: "THESIS could not save this allocation. Check the thesis and collateral amount." }, { status: 422 });

  const result = resultSchema.safeParse(data);
  if (!result.success) return NextResponse.json({ error: "THESIS returned an invalid allocation record." }, { status: 503 });
  return NextResponse.json({ allocationId: result.data.allocation_id, status: result.data.status, legCount: result.data.leg_count }, { status: 201 });
}
