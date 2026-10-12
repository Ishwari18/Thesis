type SessionResponse = { authenticated?: boolean; error?: string; detail?: string };

/** Establish and verify the server-side session required by authenticated APIs. */
export async function ensureThesisSession(accessToken: string | null): Promise<void> {
  if (!accessToken) {
    throw new Error("Privy did not provide an access token. Sign out and sign in again.");
  }

  const response = await fetch("/api/auth/privy-session", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as SessionResponse;
  if (!response.ok) {
    throw new Error([result.error ?? "THESIS could not verify your session.", result.detail]
      .filter(Boolean)
      .join(" "));
  }

  const check = await fetch("/api/auth/privy-session", { cache: "no-store" });
  const session = await check.json().catch(() => ({})) as SessionResponse;
  if (!check.ok || session.authenticated !== true) {
    throw new Error("THESIS did not retain your sign-in session. Check the dev server output and try signing in again.");
  }
}
