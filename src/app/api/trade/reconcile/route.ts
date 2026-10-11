import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppUser, adminClient } from "@/lib/auth/server";
import { readPacificaConfig } from "@/server/providers/pacifica/config";
import { reconcileAllocation } from "@/server/services/trading/reconcile";

export const dynamic = "force-dynamic";
const inputSchema = z.object({ allocationId: z.string().uuid() });

export async function POST(request: Request) {
  const appUser = await getAppUser();
  if (!appUser) return NextResponse.json({ error: "Sign in to reconcile a thesis position." }, { status: 401 });
  const config = readPacificaConfig();
  if (!config.allowedUserId || appUser.userId !== config.allowedUserId) {
    return NextResponse.json({ error: "This account is not authorized to reconcile the configured Pacifica testnet wallet." }, { status: 403 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid allocation ID." }, { status: 400 });

  try {
    // Verify ownership before calling the exchange so arbitrary allocation IDs
    // cannot be used to inspect another user's trade history.
    const { data, error } = await adminClient().from("thesis_allocations")
      .select("id,status")
      .eq("id", parsed.data.allocationId)
      .eq("user_id", appUser.userId)
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: "Thesis allocation not found." }, { status: 404 });
    const result = await reconcileAllocation(appUser.userId, parsed.data.allocationId);
    return NextResponse.json({ ...result, allocationStatus: data.status, needsReconciliation: result.unresolvedClientOrderIds.length > 0 || result.hasMoreHistory });
  } catch {
    return NextResponse.json({ error: "Pacifica trade history could not be reconciled. Unknown orders remain unresolved; do not retry them." }, { status: 503 });
  }
}
