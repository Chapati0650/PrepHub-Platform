import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Trash2 } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCollege } from "@/lib/colleges/directory";
import { admissionsCycle } from "@/lib/college-apps/cycle";
import { listSupplements } from "@/lib/college-apps/supplements";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "../../curriculum/confirm-submit-button";
import { SupplementForm } from "./supplement-form";
import { copyFromPreviousCycleAction, deleteSupplementAction, moveSupplementAction } from "../actions";

export default async function OwnerCollegeSupplementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ collegeId: string }>;
  searchParams: Promise<{ cycle?: string }>;
}) {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/home");

  const [{ collegeId: idParam }, { cycle: cycleParam }] = await Promise.all([params, searchParams]);
  const collegeId = Number(idParam);
  const college = getCollege(collegeId);
  if (!college) notFound();
  const cycle = Number(cycleParam) || admissionsCycle();

  const [rows, previousCount] = await Promise.all([
    listSupplements(collegeId, cycle),
    prisma.collegeSupplement.count({ where: { collegeId, cycle: cycle - 1 } }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <Link href={`/owner/content/supplements?cycle=${cycle}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        All colleges
      </Link>
      <PageHeader
        eyebrow={`${cycle - 1}–${String(cycle).slice(2)} supplements`}
        title={college.name}
        description={`${college.city}, ${college.state}. ${rows.length} prompt${rows.length === 1 ? "" : "s"} entered for this cycle.`}
      />

      {rows.length === 0 && previousCount > 0 && (
        <form action={copyFromPreviousCycleAction} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-surface-tint p-5">
          <input type="hidden" name="collegeId" value={collegeId} />
          <input type="hidden" name="cycle" value={cycle} />
          <p className="text-sm">
            <span className="font-medium">Last cycle had {previousCount} prompt{previousCount === 1 ? "" : "s"}.</span>{" "}
            <span className="text-muted-foreground">Copy them in as a starting point, then edit what changed.</span>
          </p>
          <Button type="submit" variant="outline" className="rounded-full">
            Copy from {cycle - 2}–{String(cycle - 1).slice(2)}
          </Button>
        </form>
      )}

      {rows.length > 0 && (
        <ol className="flex flex-col divide-y divide-border rounded-2xl border border-border">
          {rows.map((r, i) => (
            <li key={r.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start gap-3">
                <span className="w-6 shrink-0 pt-1 font-heading text-sm font-semibold tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <SupplementForm collegeId={collegeId} cycle={cycle} existing={{ id: r.id, title: r.title, promptText: r.promptText, wordLimit: r.wordLimit }} />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <form action={moveSupplementAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="collegeId" value={collegeId} />
                    <input type="hidden" name="cycle" value={cycle} />
                    <input type="hidden" name="direction" value="up" />
                    <Button type="submit" variant="ghost" size="icon-sm" disabled={i === 0} aria-label={`Move ${r.title} up`}>
                      <ArrowUp className="size-4" />
                    </Button>
                  </form>
                  <form action={moveSupplementAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="collegeId" value={collegeId} />
                    <input type="hidden" name="cycle" value={cycle} />
                    <input type="hidden" name="direction" value="down" />
                    <Button type="submit" variant="ghost" size="icon-sm" disabled={i === rows.length - 1} aria-label={`Move ${r.title} down`}>
                      <ArrowDown className="size-4" />
                    </Button>
                  </form>
                  <form action={deleteSupplementAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="collegeId" value={collegeId} />
                    <input type="hidden" name="cycle" value={cycle} />
                    <ConfirmSubmitButton
                      confirm={`Delete "${r.title}"? Students who already added ${college.name} keep their copy; new ones won't get it. This cannot be undone.`}
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${r.title}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <section className="rounded-2xl border border-border p-5">
        <h2 className="mb-4 font-medium">Add a prompt</h2>
        <SupplementForm collegeId={collegeId} cycle={cycle} existing={null} />
      </section>
    </div>
  );
}
