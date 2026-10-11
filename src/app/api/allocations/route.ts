import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
const inputSchema = z.object({
  thesisSlug: z.string().regex(/^[a-z0-9-]{1,100}$/),
  collateral: z.string().regex(/^\d+(\.\d{1,2})?$/).refine((value) => Number.isSafeInteger(Number(value) * 100)),
  leverage: z.union([z.literal(2), z.literal(3), z.literal(5)]),
});

// The old save-only endpoint is retired. Creating a pending allocation before
// a separate execute request could leave an orphan if the browser disappeared.
export async function POST(request: Request) {
  if (!await getAppUser()) return NextResponse.json({ error: "Your session could not be verified. Please sign in again." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid collateral amount and choose 2x, 3x, or 5x." }, { status: 400 });
  return NextResponse.json({ error: "Save-only allocations are no longer supported. Open the position through /api/trade/open." }, { status: 410 });
}
