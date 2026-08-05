import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listQuestions } from "@/lib/content/list-questions";
import { FAMILY_ELIGIBLE_CATEGORIES, FAMILY_VERSION_COUNT } from "@/lib/content/constants";
import { CATEGORY_LABELS, DIFFICULTY_LABELS, STATUS_LABELS } from "@/lib/content/labels";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateFamilyDialog } from "./create-family-dialog";
import { GroupQuestionsDialog } from "./group-questions-dialog";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "PUBLISHED") return "default";
  if (status === "ARCHIVED") return "destructive";
  return "secondary";
}

// PRD-015 §8.6: Question Families table.
export default async function QuestionFamiliesPage() {
  const [families, eligibleResult] = await Promise.all([
    prisma.questionFamily.findMany({
      include: { sharedVideo: true, questions: { select: { id: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    listQuestions({ familyMembership: "NOT_IN_FAMILY", status: "DRAFT", pageSize: 100 }),
  ]);

  const eligibleQuestions = eligibleResult.rows.filter((q) => FAMILY_ELIGIBLE_CATEGORIES.includes(q.category));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Question Families</h1>
        <div className="flex gap-2">
          <GroupQuestionsDialog eligibleQuestions={eligibleQuestions} />
          <CreateFamilyDialog />
        </div>
      </div>

      {families.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Question Families yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Family</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Difficulty</TableHead>
                <TableHead>Versions</TableHead>
                <TableHead>Video</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {families.map((family) => (
                <TableRow key={family.id}>
                  <TableCell className="font-medium">{family.internalName ?? family.id}</TableCell>
                  <TableCell className="text-sm">{CATEGORY_LABELS[family.category]}</TableCell>
                  <TableCell className="text-sm">{DIFFICULTY_LABELS[family.difficulty]}</TableCell>
                  <TableCell className="text-sm">
                    {family.questions.length} / {FAMILY_VERSION_COUNT}
                  </TableCell>
                  <TableCell className="text-sm">
                    {family.sharedVideo?.status === "READY" ? "Present" : "Missing"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(family.status)}>{STATUS_LABELS[family.status]}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(family.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <Link href={`/owner/content/families/${family.id}`} className="text-sm underline">
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
