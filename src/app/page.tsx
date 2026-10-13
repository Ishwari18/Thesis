
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
          <h1>Discover</h1>
          <p className="subheading">
           Trade your convictions.
          </p>
        </div>
      </div>

      <Discovery theses={theses} />
    </main>
  );
}
