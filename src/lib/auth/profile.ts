import type { User } from "@privy-io/react-auth";

export type ProfileView = { name: string; avatarUrl?: string };

/** Derive display-only profile data from fields verified and returned by Privy. */
export function getPrivyProfile(user: User | null | undefined): ProfileView {
  if (!user) return { name: "THESIS member" };
  if (user.twitter) {
    const name = user.twitter.username
      ? `@${user.twitter.username}`
      : user.twitter.name?.trim() || user.google?.name?.trim() || user.email?.address || "THESIS member";
    const avatarUrl = safeTwitterAvatar(user.twitter.profilePictureUrl);
    return { name, ...(avatarUrl ? { avatarUrl } : {}) };
  }
  return { name: user.google?.name?.trim() || user.email?.address || user.wallet?.address || "THESIS member" };
}

function safeTwitterAvatar(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "pbs.twimg.com" ? url.toString() : undefined;
  } catch { return undefined; }
}

export function abbreviatedAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-5)}` : address;
}

