import { NextResponse } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = (await cookies()).get("privy-token")?.value;
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  let authenticated = false;
  if (token && appId && appSecret) {
    try {
      await new PrivyClient(appId, appSecret).verifyAuthToken(token);
      authenticated = true;
    } catch { /* Expired or invalid session cookies are treated as logged out. */ }
  }
  return NextResponse.json({ authenticated }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) return NextResponse.json({ error: "A Privy access token is required." }, { status: 401 });
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) return NextResponse.json({ error: "Privy server authentication is not configured." }, { status: 503 });
  try {
    const privy = new PrivyClient(appId, appSecret);
    await privy.verifyAuthToken(token);
    const response = NextResponse.json({ ok: true });
    response.cookies.set("privy-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60,
    });
    return response;
  } catch (error) {
    console.error("[auth] Privy access-token verification failed:", error);
    return NextResponse.json({
      error: "The Privy access token could not be verified.",
      ...(process.env.NODE_ENV !== "production" && error instanceof Error
        ? { detail: error.message }
        : {}),
    }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("privy-token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
