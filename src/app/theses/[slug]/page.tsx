import { notFound } from "next/navigation";
import { getThesis, theses } from "@/server/services/theses/demo";
import { ThesisDetail } from "@/components/thesis-detail";
export function generateStaticParams() { return theses.map(t=>({slug:t.slug})); }
export default async function ThesisPage({params}:{params:Promise<{slug:string}>}) { const {slug}=await params; const thesis=getThesis(slug); if(!thesis)notFound(); return <main className="page-shell detail-shell"><ThesisDetail thesis={thesis}/></main>; }
