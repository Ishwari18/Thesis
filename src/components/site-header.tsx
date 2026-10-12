"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Search, Wallet } from "lucide-react";
import { useActiveWallet, usePrivy } from "@privy-io/react-auth";
import { abbreviatedAddress, getPrivyProfile } from "@/lib/auth/profile";
import { connectAndLinkPhantom, disconnectInjectedPhantom } from "@/lib/auth/phantom-connection";
import { ensureThesisSession } from "@/lib/auth/session";

function authHref(next: string) {
  return `/auth?next=${encodeURIComponent(next.startsWith("/") && !next.startsWith("//") ? next : "/discover")}`;
}

export function SiteHeader() {
  const router = useRouter();
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { wallet } = useActiveWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [phantomAddress, setPhantomAddress] = useState<string | null>(null);
  const [appSession, setAppSession] = useState<boolean | null>(null);
  const profile = getPrivyProfile(user);
  const isAuthenticated = authenticated || appSession === true;

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

  return <header className="site-header">
    <Link href="/discover" className="wordmark">THESIS<span className="wordmark-mark">/</span></Link>
    <label className="global-search"><Search size={15} /><input aria-label="Search theses" placeholder="What do you want to trade?" onKeyDown={e => { if (e.key === "Enter") { const q = (e.currentTarget as HTMLInputElement).value; location.href = `/discover?q=${encodeURIComponent(q)}`; } }} /><kbd>⌘ K</kbd></label>
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
        <Link href="/portfolio" className="portfolio-nav">Portfolio</Link>
        {ready && appSession !== null ? <Link className="wallet-button" href={authHref(typeof window === "undefined" ? "/discover" : `${location.pathname}${location.search}`)}><span>Log in</span></Link> : <span className="wallet-button auth-loading" aria-label="Checking authentication" aria-busy="true">Checking…</span>}
      </>}
    </div>
  </header>;
}
