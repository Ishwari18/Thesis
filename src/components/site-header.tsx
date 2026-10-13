"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Wallet } from "lucide-react";
import { useActiveWallet, useLogin, usePrivy } from "@privy-io/react-auth";
import { abbreviatedAddress, getPrivyProfile } from "@/lib/auth/profile";
import { connectAndLinkPhantom, connectInjectedPhantom, disconnectInjectedPhantom } from "@/lib/auth/phantom-connection";
import { ensureThesisSession } from "@/lib/auth/session";

export function SiteHeader() {
  const router = useRouter();
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { wallet } = useActiveWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [phantomAddress, setPhantomAddress] = useState<string | null>(null);
  const [pendingPhantomAddress, setPendingPhantomAddress] = useState<string | null>(null);
  const [appSession, setAppSession] = useState<boolean | null>(null);
  const [signInError, setSignInError] = useState("");
  const profile = getPrivyProfile(user);
  const isAuthenticated = authenticated || appSession === true;

  const { login } = useLogin({
    onComplete: async () => {
      setSignInError("");
      try {
        await ensureThesisSession(await getAccessToken());
        setAppSession(true);
        router.refresh();
      } catch (error) {
        setSignInError(error instanceof Error ? error.message : "THESIS could not verify your session.");
      }
    },
  });

  useEffect(() => {
    let cancelled = false;
    if (ready && authenticated) {
      void getAccessToken()
        .then((token) => ensureThesisSession(token))
        .then(() => { if (!cancelled) setAppSession(true); })
        .catch(() => { if (!cancelled) setAppSession(false); });
      return () => { cancelled = true; };
    }
    fetch("/api/auth/privy-session", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { authenticated?: boolean };
        if (!cancelled) setAppSession(response.ok && data.authenticated === true);
      })
      .catch(() => { if (!cancelled) setAppSession(false); });
    return () => { cancelled = true; };
  }, [ready, authenticated, getAccessToken]);

  useEffect(() => {
    if (!ready || !isAuthenticated) { setPhantomAddress(null); return; }
    let cancelled = false;
    fetch("/api/auth/phantom", { cache: "no-store" }).then(async (response) => {
      const data = await response.json() as { address?: string | null };
      if (!cancelled && response.ok) setPhantomAddress(data.address ?? null);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [ready, isAuthenticated]);

  async function connectPhantom() {
    setWalletError("");
    try {
      await ensureThesisSession(await getAccessToken());
      setAppSession(true);
      setPhantomAddress(await connectAndLinkPhantom());
      router.refresh();
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Phantom could not be connected.");
    }
  }

  async function connectWalletBeforeSignIn() {
    setWalletError("");
    try {
      setPendingPhantomAddress(await connectInjectedPhantom());
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Phantom could not be connected.");
    }
  }

  return <header className="site-header">
    <Link href="/discover" className="wordmark"><Image src="/images/thesis-mark.jpg" alt="" width={26} height={26} unoptimized aria-hidden="true" /><span>THESIS</span></Link>
    <div className="header-right">
      {ready && (authenticated || appSession === true) ? <div className="profile-menu-wrap">
        <button className="profile-trigger" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
          {profile.avatarUrl ? <span className="profile-avatar" role="img" aria-label={`${profile.name} avatar`} style={{ backgroundImage: `url("${profile.avatarUrl}")` }} /> : <span className="profile-avatar profile-avatar-fallback" aria-hidden="true">{profile.name.slice(0, 1).toUpperCase()}</span>}
          <span className="profile-name">{profile.name}</span><ChevronDown size={13} />
        </button>
        {menuOpen && <div className="profile-dropdown" role="menu">
          <Link role="menuitem" href="/portfolio" onClick={() => setMenuOpen(false)}>Portfolio</Link>
          <button role="menuitem" onClick={() => phantomAddress ? setMenuOpen(false) : connectPhantom()}><Wallet size={14} />{phantomAddress ? `Wallet linked · ${abbreviatedAddress(phantomAddress)}` : "Connect wallet"}</button>
          {phantomAddress && <button role="menuitem" onClick={connectPhantom}>Change wallet</button>}
          {phantomAddress && <button role="menuitem" onClick={async () => { const response = await fetch("/api/auth/phantom", { method: "DELETE" }); if (response.ok) { setPhantomAddress(null); await disconnectInjectedPhantom(); wallet?.disconnect(); } setMenuOpen(false); }}>Disconnect wallet</button>}
          {walletError && <p className="wallet-menu-error" role="alert">{walletError}{walletError.includes("isn't available") && <> <a href="https://phantom.com/download" target="_blank" rel="noreferrer">Install Phantom</a></>}</p>}
          <button role="menuitem" onClick={async () => { await logout(); await fetch("/api/auth/privy-session", { method: "DELETE" }); setAppSession(false); setPhantomAddress(null); setMenuOpen(false); router.refresh(); }}>Log out</button>
        </div>}
      </div> : <>
        <div className="header-auth-actions">
          <button className="header-sign-in" type="button" onClick={() => { setSignInError(""); login(); }}>Sign in</button>
          <button className="header-wallet-connect" type="button" onClick={connectWalletBeforeSignIn} aria-label={pendingPhantomAddress ? `Phantom connected, ${abbreviatedAddress(pendingPhantomAddress)}` : "Connect Phantom wallet"} title={pendingPhantomAddress ? `Phantom connected · ${abbreviatedAddress(pendingPhantomAddress)}. Sign in to link it.` : "Connect Phantom wallet"}>
            <Wallet size={17} strokeWidth={1.8} aria-hidden="true" />
          </button>
          {signInError && <span className="header-wallet-error" role="alert">{signInError}</span>}
          {walletError && <span className="header-wallet-error" role="alert">{walletError}</span>}
        </div>
      </>}
    </div>
  </header>;
}
