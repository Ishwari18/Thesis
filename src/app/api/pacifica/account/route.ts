import { NextResponse } from "next/server";
import { getAppUser, getLinkedSolanaWallet } from "@/lib/auth/server";
import { getPacificaAccount } from "@/server/providers/pacifica/account";
import { getPacificaPositions } from "@/server/providers/pacifica/positions";
import { getPacificaLeverageSettings } from "@/server/providers/pacifica/account-settings";
import { safePacificaMessage } from "@/server/providers/pacifica/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const appUser = await getAppUser();
  if (!appUser) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }
  const address = await getLinkedSolanaWallet(appUser.userId);
  if (!address) return NextResponse.json({ error: "Connect Phantom to check your Pacifica testnet balance." }, { status: 403 });
  try {
    const [account, positions, leverageSettings] = await Promise.all([getPacificaAccount(undefined, address), getPacificaPositions(undefined, address), getPacificaLeverageSettings(undefined, address)]);
    return NextResponse.json({ source: "pacifica-testnet", account, positions, leverageSettings: Object.fromEntries(leverageSettings) });
  } catch (error) {
    return NextResponse.json({ error: safePacificaMessage(error) }, { status: 503 });
  }
}
