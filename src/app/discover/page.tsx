
import { Discovery } from "@/components/discovery";
//import { listTheses } from "@/server/theses/service";
import { listTheses } from "@/server/services/theses/service";
export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const theses = await listTheses();

  return (
    <main className="page-shell">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            THE MARKET, THROUGH A POINT OF VIEW
          </div>
          <h1>Discover</h1>
          <p className="subheading">
            Curated ideas. Clear exposure. Your call.
          </p>
        </div>

        <div className="demo-note">
          <span className="demo-dot" />
          SIMULATED RETURNS
        </div>
      </div>

      <Discovery theses={theses} />
    </main>
  );
}
