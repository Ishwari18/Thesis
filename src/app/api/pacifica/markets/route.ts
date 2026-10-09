import { NextResponse } from "next/server";
import { theses } from "@/server/services/theses/demo";
import { readPacificaConfig } from "@/server/providers/pacifica/config";
import { fetchPacificaSnapshot } from "@/server/providers/pacifica/market-data";
import { safePacificaMessage } from "@/server/providers/pacifica/errors";
export const dynamic="force-dynamic";
const symbols=new Set(theses.flatMap(t=>t.assets.map(a=>a.symbol)));
export async function GET(request:Request){const config=readPacificaConfig();if(!config.marketDataEnabled)return NextResponse.json({mode:"demo"});try{const snapshot=await fetchPacificaSnapshot();const requested=new URL(request.url).searchParams.getAll("symbol");const filter=requested.length?new Set(requested.filter(s=>symbols.has(s))):symbols;return NextResponse.json({mode:"live-testnet",source:snapshot.source,observedAt:snapshot.observedAt,markets:snapshot.markets.filter(m=>filter.has(m.symbol)),quotes:snapshot.quotes.filter(q=>filter.has(q.symbol))},{headers:{"Cache-Control":"private, max-age=5, stale-while-revalidate=10"}});}catch(error){return NextResponse.json({mode:"error",message:safePacificaMessage(error)},{status:503});}}
