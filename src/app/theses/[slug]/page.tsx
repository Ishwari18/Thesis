
import { notFound } from "next/navigation";
import { ThesisDetail } from "@/components/thesis-detail";
import { getThesisBySlug } from "@/server/services/theses/service";

export const dynamic = "force-dynamic";

export default async function ThesisPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const thesis = await getThesisBySlug(slug);

  if (!thesis) {
    notFound();
  }

  return (
    <main className="page-shell detail-shell">
      <ThesisDetail thesis={thesis} />
    </main>
  );
}
