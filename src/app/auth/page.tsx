"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLogin, usePrivy } from "@privy-io/react-auth";

function safeNext() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/portfolio";
}

export default function PrivyLogin() {
  const router = useRouter();
  //const { ready, authenticated, user, logout } = usePrivy();
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { login } = useLogin({
  onComplete: async () => {
    const token = await getAccessToken();

    if (!token) {
      console.error("Privy did not return an access token.");
      return;
    }

    const response = await fetch("/api/auth/privy-session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      console.error("Could not establish the THESIS session.");
      return;
    }

    router.replace(safeNext());
    router.refresh();
  },
});

  if (!ready) return <p>Loading...</p>;

  if (authenticated) {
    return (
      <div>
        <p>{user?.email?.address ?? user?.wallet?.address ?? "THESIS user"}</p>
        <Link href="/portfolio">Open portfolio</Link>
        <button onClick={async () => { await logout(); router.refresh(); }}>Log out</button>
      </div>
    );
  }
  return <button onClick={() => login()}>Continue to THESIS</button>;
}