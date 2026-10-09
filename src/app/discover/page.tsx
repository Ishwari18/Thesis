import { Discovery } from "@/components/discovery";
import { theses } from "@/server/services/theses/demo";
export default function DiscoverPage() { return <main className="page-shell"><div className="page-heading"><div><div className="eyebrow">THE MARKET, THROUGH A POINT OF VIEW</div><h1>Discover</h1><p className="subheading">Curated ideas. Clear exposure. Your call.</p></div><div className="demo-note"><span className="demo-dot"/> DEMO MARKETS · SIMULATED RETURNS</div></div><Discovery theses={theses}/></main>; }
