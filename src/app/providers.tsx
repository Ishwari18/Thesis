
"use client";

import { PrivyProvider } from "@privy-io/react-auth";

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    throw new Error("Missing NEXT_PUBLIC_PRIVY_APP_ID in .env.local");
  }

  return <PrivyProvider appId={appId}
   config={{
    loginMethods: ["email", "google", "twitter", "wallet"],
  }}>{children}</PrivyProvider>;
}
