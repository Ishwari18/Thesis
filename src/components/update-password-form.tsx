"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { describeAuthError } from "@/lib/supabase/auth-errors";

export function UpdatePasswordForm() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [message, setMessage] = useState("");
  const [diagnostic, setDiagnostic] = useState("");
  const submitting = useRef(false);
  const config = getSupabasePublicConfig();

  useEffect(() => {
    if (!config.ok) {
      setCheckingSession(false);
      return;
    }
    let active = true;
    const client = createClient();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (active) {
        setHasRecoverySession(Boolean(session));
        setCheckingSession(false);
      }
    });
    client.auth.getSession().then(({ data: { session }, error }) => {
      if (!active) return;
      if (error) {
        const failure = describeAuthError(error, "password-reset", [process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""]);
        setMessage(failure.message);
        setDiagnostic(failure.diagnostic);
      } else {
        setHasRecoverySession(Boolean(session));
      }
      setCheckingSession(false);
    }).catch(error => {
      if (active) {
        const failure = describeAuthError(error, "password-reset", [process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""]);
        setMessage(failure.message);
        setDiagnostic(failure.diagnostic);
        setCheckingSession(false);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [config.ok]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config.ok || !hasRecoverySession || submitting.current) return;
    if (password !== confirmation) {
      setMessage("The passwords do not match.");
      setDiagnostic("");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setMessage("");
    setDiagnostic("");
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) {
        const failure = describeAuthError(error, "password-reset", [password, confirmation, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""]);
        setMessage(failure.message);
        setDiagnostic(failure.diagnostic);
        return;
      }
      setPassword("");
      setConfirmation("");
      setUpdated(true);
      setMessage("Your password has been updated. This recovery session is signed in.");
    } catch (error) {
      const failure = describeAuthError(error, "password-reset", [password, confirmation, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""]);
      setMessage(failure.message);
      setDiagnostic(failure.diagnostic);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <section className="auth-card">
    <div className="eyebrow">PASSWORD RESET</div>
    <h2>Set a new password</h2>
    {!config.ok
      ? <p className="auth-muted">{config.message}</p>
      : checkingSession
        ? <p className="auth-muted">Verifying your recovery link…</p>
        : !hasRecoverySession
          ? <p className="auth-message" role="alert">This password reset link is invalid or expired. Request another link to continue.</p>
          : updated
            ? <p className="auth-message" role="status">{message}</p>
            : <form onSubmit={submit}>
                <label>New password<input autoComplete="new-password" type="password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} /></label>
                <label>Confirm new password<input autoComplete="new-password" type="password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
                <button className="primary-trade" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
              </form>}
    {message && !updated && <p className="auth-message" role="alert">{message}</p>}
    {diagnostic && process.env.NODE_ENV === "development" && <details className="auth-diagnostic"><summary>Developer diagnostic</summary><code>{diagnostic}</code></details>}
    {updated && <Link className="auth-switch" href="/discover">Continue to THESIS</Link>}
    {!hasRecoverySession && !checkingSession && <Link className="auth-switch" href="/auth">Return to sign in</Link>}
  </section>;
}
