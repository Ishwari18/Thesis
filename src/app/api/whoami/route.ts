import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";

export async function GET() {
  const names = (await cookies()).getAll().map((c) => c.name);
  const { data, error } = await (await createClient()).auth.getUser();
  return NextResponse.json({ cookieNames: names, user: data.user?.email ?? null, error: error?.message ?? null });
}