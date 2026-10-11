import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppUser, adminClient } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  thesisSlug: z.string().regex(/^[a-z0-9-]{1,100}$/),
  collateral: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine((value) => Number.isSafeInteger(Number(value) * 100)),
  leverage: z.union([z.literal(2), z.literal(3), z.literal(5)]),
});

const resultSchema = z.object({
  allocation_id: z.string().uuid(),
  status: z.literal("pending"),
  leg_count: z.number().int().min(1).max(10),
});

export async function POST(request: Request) {
  // Verify the existing Privy session and resolve its linked app user.
  const appUser = await getAppUser();

  if (!appUser) {
    return NextResponse.json(
      { error: "Your session could not be verified. Please sign in again." },
      { status: 401 },
    );
  }

  const parsed = inputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid collateral amount and choose 2x, 3x, or 5x." },
      { status: 400 },
    );
  }

  try {
    // This service-role client is server-only. The user ID comes from
    // the verified Privy-to-Supabase link, never from browser input.
    const db = adminClient();
    const { data, error } = await db.rpc(
      "create_thesis_allocation_for_user",
      {
        p_user_id: appUser.userId,
        p_thesis_slug: parsed.data.thesisSlug,
        p_collateral: Number(parsed.data.collateral),
        p_leverage: parsed.data.leverage,
      },
    );

    if (error) {
      console.error("Allocation save failed:", error.message);
      return NextResponse.json(
        { error: "The allocation could not be saved. Check the collateral and thesis requirements." },
        { status: 422 },
      );
    }

    const result = resultSchema.safeParse(data);

    if (!result.success) {
      console.error("Allocation save returned an unexpected result.");
      return NextResponse.json(
        { error: "The server returned an invalid allocation record." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        allocationId: result.data.allocation_id,
        status: result.data.status,
        legCount: result.data.leg_count,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error(
      "Allocation save failed:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return NextResponse.json(
      { error: "The allocation service is temporarily unavailable." },
      { status: 503 },
    );
  }
}
