import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { admissionsCycle } from "@/lib/college-apps/cycle";
import { listCuratedColleges } from "@/lib/college-apps/supplements";
import { PageHeader } from "@/components/page-header";
import { OwnerCollegeSearch } from "./owner-college-search";

// The Owner's August job: which colleges have this cycle's supplements
// entered. Pick a college (search) to enter or edit its prompts.
export default async function OwnerSupplementsPage({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/home");

  const { cycle: cycleParam } = await searchParams;
  const current = admissionsCycle();
  const cycle = Number(cycleParam) || current;
  const curated = await listCuratedColleges(cycle);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Content"
        title="College supplements"
        description={`Essay prompts per college for the ${cycle - 1}–${String(cycle).slice(2)} admissions cycle. A student who adds a college gets a copy of these; editing here never changes a list they already have.`}
      >
        <div className="flex items-center gap-2 text-sm">
          {[current - 1, current, current + 1].map((c) => (
            <Link
              key={c}
              href={`/owner/content/supplements?cycle=${c}`}
              aria-current={c === cycle ? "page" : undefined}
              className={c === cycle ? "rounded-full bg-muted px-3 py-1 font-medium" : "rounded-full px-3 py-1 text-muted-foreground hover:bg-muted/60"}
            >
              {c - 1}–{String(c).slice(2)}
            </Link>
          ))}
        </div>
      </PageHeader>

      <section className="rounded-2xl border border-border p-5">
        <h2 className="font-medium">Find a college</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">Search the directory, then enter its prompts for this cycle.</p>
        <OwnerCollegeSearch cycle={cycle} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Curated for {cycle - 1}–{String(cycle).slice(2)} · {curated.length} college{curated.length === 1 ? "" : "s"}
        </h2>
        {curated.length === 0 ? (
          <div className="rounded-2xl bg-surface-tint p-6 text-sm text-muted-foreground">
            Nothing entered for this cycle yet. Students can still paste a college&apos;s prompts themselves; what you enter
            here fills in automatically.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {curated.map((c) => (
              <li key={c.collegeId}>
                <Link href={`/owner/content/supplements/${c.collegeId}?cycle=${cycle}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-muted/40">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {c.count} prompt{c.count === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
