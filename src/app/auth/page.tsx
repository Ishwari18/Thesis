"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import { safeAuthRedirectPath } from "@/lib/supabase/redirect";
import { ensureThesisSession } from "@/lib/auth/session";

export default function PrivyLogin() {
  const router = useRouter();
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const [message, setMessage] = useState("");
  async function continueToNext() {
    setMessage("");
    const token = await getAccessToken();
    try { await ensureThesisSession(token); }
    catch (error) { return setMessage(error instanceof Error ? error.message : "THESIS could not verify your session."); }
    router.replace(safeAuthRedirectPath(new URLSearchParams(window.location.search).get("next")));
    router.refresh();
  }
  const { login } = useLogin({
    onComplete: continueToNext,
  });

  return <main className="page-shell auth-shell">
    <div className="auth-copy"><div className="eyebrow">THESIS ACCESS</div><h1>Trade a point of view.</h1><p>Sign in with Privy to manage your portfolio and continue to the thesis you selected. You can keep exploring Discover without signing in.</p></div>
    <section className="auth-card" aria-live="polite">
      <div className="eyebrow">ACCOUNT ACCESS</div>
      {!ready ? <p className="auth-muted" role="status">Checking your sign-in…</p> : authenticated ? <>
        <h2>{user?.twitter?.username ? `@${user.twitter.username}` : user?.google?.name || user?.email?.address || "THESIS member"}</h2>
        <p className="auth-muted">Your THESIS login is connected. Wallet connection and Pacifica testnet funding are separate steps.</p>
        <button className="primary-trade" onClick={continueToNext}>Continue</button>
        <button className="auth-switch" onClick={async () => { await logout(); await fetch("/api/auth/privy-session", { method: "DELETE" }); router.refresh(); }}>Log out</button>
      </> : <>
        <h2>Log in to THESIS</h2>
        <p className="auth-muted">Continue with email, Google, X, or a wallet through Privy. After signing in, connect Phantom to prepare to trade.</p>
        <button className="primary-trade" onClick={() => login()}>Log in</button>
      </>}
      {message && <p className="auth-message" role="alert">{message}</p>}
      <Link className="auth-back" href="/discover">Continue browsing Discover</Link>
    </section>
  </main>;
}
