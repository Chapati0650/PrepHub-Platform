import { notFound } from "next/navigation";
import { getFamilyOrThrow } from "@/lib/content/families";
import { listQuestions } from "@/lib/content/list-questions";
import { ContentError } from "@/lib/content/errors";
import { FAMILY_ELIGIBLE_CATEGORIES } from "@/lib/content/constants";
import { FamilyDetail } from "./family-detail";

export default async function FamilyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const family = await getFamilyOrThrow(id).catch((err) => {
    if (err instanceof ContentError && err.code === "FAMILY_NOT_FOUND") return null;
    throw err;
  });
  if (!family) notFound();

  const eligibleResult = await listQuestions({ familyMembership: "NOT_IN_FAMILY", status: "DRAFT", pageSize: 100 });
  const eligibleQuestions = eligibleResult.rows.filter(
    (q) =>
      FAMILY_ELIGIBLE_CATEGORIES.includes(q.category) &&
      q.category === family.category &&
      q.difficulty === family.difficulty,
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <FamilyDetail family={family} eligibleQuestions={eligibleQuestions} />
    </div>
  );
}
