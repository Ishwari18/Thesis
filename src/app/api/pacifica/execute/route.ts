import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppUser } from "@/lib/auth/server";
import { readPacificaConfig } from "@/server/providers/pacifica/config";

export const dynamic = "force-dynamic";
const inputSchema = z.object({ allocationId: z.string().uuid(), idempotencyKey: z.string().uuid() });

// This endpoint used to submit an allocation created in a separate browser
// request. It is retired to keep intent creation and execution in one flow.
export async function POST(request: Request) {
  const appUser = await getAppUser();
  if (!appUser) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  const config = readPacificaConfig();
  if (!config.allowedUserId || appUser.userId !== config.allowedUserId) {
    return NextResponse.json({ error: "Testnet execution is restricted to the configured single Supabase user." }, { status: 403 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide an allocation ID and UUID idempotency key." }, { status: 400 });
  return NextResponse.json({ error: "This two-request execution route is retired. Use /api/trade/open so allocation and execution are coordinated server-side." }, { status: 410 });
}
