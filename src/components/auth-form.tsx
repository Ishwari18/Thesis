"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { describeAuthError, type AuthMode } from "@/lib/supabase/auth-errors";

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [diagnostic, setDiagnostic] = useState("");
  const [user, setUser] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const config = getSupabasePublicConfig();
  const configured = config.ok;

  useEffect(() => {
    if (!configured) return;
    const client = createClient();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => setUser(session?.user?.email ?? null));
    return () => subscription.unsubscribe();
  }, [configured]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("auth_error") === "confirmation") {
      setMessage("We couldn’t confirm this email link. It may have expired or already been used. Request a new confirmation email or sign in.");
    }
  }, []);

  function clearFeedback() { setMessage(""); setDiagnostic(""); }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    clearFeedback();
    const normalizedEmail = email.trim();
    const safeValues = [normalizedEmail, password, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""];
    try {
      const client = createClient();
      if (mode === "password-reset") {
        const { error } = await client.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/auth/update-password")}`,
        });
        if (error) {
          const failure = describeAuthError(error, mode, safeValues);
          setMessage(failure.message);
          setDiagnostic(failure.diagnostic);
          return;
        }
        setPassword("");
        setMessage("If an account exists for that email, a password reset link has been sent.");
        return;
      }

      const result = mode === "sign-in"
        ? await client.auth.signInWithPassword({ email: normalizedEmail, password })
        : await client.auth.signUp({ email: normalizedEmail, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/discover")}` } });
      if (result.error) {
        const failure = describeAuthError(result.error, mode, safeValues);
        setMessage(failure.message);
        setDiagnostic(failure.diagnostic);
        return;
      }
      if (mode === "sign-up" && !result.data.session) {
        setMessage("Account request received. Confirm your email using the link we sent, then sign in.");
        return;
      }
      if (!result.data.session || !result.data.user) {
        setMessage("Supabase did not return an active session. Try signing in again.");
        return;
      }
      setUser(result.data.user.email ?? normalizedEmail);
setPassword("");

if (mode === "sign-in") {
  window.location.assign("/portfolio");
  return;
}

setMessage("Account created and signed in.");
      } catch (error) {
      const failure = describeAuthError(error, mode, safeValues);
      setMessage(failure.message);
      setDiagnostic(failure.diagnostic);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function signOut() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    clearFeedback();
    try {
      const { error } = await createClient().auth.signOut();
      if (error) {
        const failure = describeAuthError(error, "sign-in", [user ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""]);
        setMessage(failure.message);
        setDiagnostic(failure.diagnostic);
        return;
      }
      setUser(null);
      setPassword("");
      setMessage("Signed out.");
    } catch (error) {
      const failure = describeAuthError(error, "sign-in", [user ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""]);
      setMessage(failure.message);
      setDiagnostic(failure.diagnostic);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    clearFeedback();
  }

  const title = mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create your account" : "Reset your password";

  return <section className="auth-card">
    <div className="eyebrow">{user ? "ACCOUNT CONNECTED" : mode === "sign-in" ? "ACCOUNT ACCESS" : mode === "sign-up" ? "CREATE ACCOUNT" : "PASSWORD RESET"}</div>
    {user ? <>
      <h2>{user}</h2>
      <p className="auth-muted">Your live allocation history is separate for each thesis.</p>
      <button className="primary-trade" disabled={busy} onClick={signOut}>{busy ? "Please wait…" : "Sign out"}</button>
    </> : <>
      <h2>{title}</h2>
      <form onSubmit={submit}>
        <label>Email<input autoComplete="email" type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        {mode !== "password-reset" && <label>Password<input autoComplete={mode === "sign-in" ? "current-password" : "new-password"} type="password" minLength={mode === "sign-up" ? 8 : 1} required value={password} onChange={event => setPassword(event.target.value)} /></label>}
        <button className="primary-trade" disabled={!configured || busy}>{busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create account" : "Send reset link"}</button>
      </form>
      {mode === "sign-in" && <button className="auth-switch" disabled={busy} onClick={() => switchMode("password-reset")}>Forgot password?</button>}
      {mode === "password-reset"
        ? <button className="auth-switch" disabled={busy} onClick={() => switchMode("sign-in")}>Back to sign in</button>
        : <button className="auth-switch" disabled={busy} onClick={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}>{mode === "sign-in" ? "New to THESIS? Create an account" : "Already have an account? Sign in"}</button>}
    </>}
    {message && <p className="auth-message" role="alert">{message}</p>}
    {diagnostic && process.env.NODE_ENV === "development" && <details className="auth-diagnostic"><summary>Developer diagnostic</summary><code>{diagnostic}</code></details>}
    {!configured && <p className="auth-muted">{config.message} Demo browsing remains available.</p>}
    <Link className="auth-back" href="/discover">Continue to demo markets</Link>
  </section>;
}
