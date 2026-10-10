import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/auth/server";
import { readPacificaConfig } from "@/server/providers/pacifica/config";
import { getPacificaAccount } from "@/server/providers/pacifica/account";
import { getPacificaPositions } from "@/server/providers/pacifica/positions";
import { safePacificaMessage } from "@/server/providers/pacifica/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = readPacificaConfig();
  const appUser = await getAppUser();
  if (!appUser) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }
  if (!config.allowedUserId || appUser.userId !== config.allowedUserId) {
    return NextResponse.json(
      { error: "Pacifica account reads are restricted to the configured testnet user." },
      { status: 403 },
    );
  }
  try {
    const [account, positions] = await Promise.all([getPacificaAccount(), getPacificaPositions()]);
    return NextResponse.json({ source: "pacifica-testnet", account, positions });
  } catch (error) {
    return NextResponse.json({ error: safePacificaMessage(error) }, { status: 503 });
  }
}