
"use client";

import { usePrivy } from "@privy-io/react-auth";

export default function PrivyLogin() {
  const { ready, authenticated, user, login, logout } = usePrivy();

  if (!ready) return <p>Loading...</p>;

  if (authenticated) {
    return (
      <div>
        <p>You&apos;re signed in.</p>
        <p>{user?.email?.address ?? user?.wallet?.address ?? "THESIS user"}</p>
        <button onClick={() => logout()}>Log out</button>
      </div>
    );
  }

  return (
    <button onClick={() => login()}>
      Continue to THESIS
    </button>
  );
}
