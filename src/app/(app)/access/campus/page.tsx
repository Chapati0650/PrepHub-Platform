import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { findDistrictMatch } from "@/lib/district/enrollment";
import { LinkButton } from "@/components/ui/link-button";
import { CampusForm } from "./campus-form";

// A verified student in a multi-campus district, which a domain alone can't
// place: StudentMembership.schoolId must be one specific campus (PRD-017 §3),
// so rather than guess — and quietly corrupt the per-campus numbers an
// Administrator reports on — we ask. Reached from the district bar.
export default async function ChooseCampusPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "STUDENT") redirect("/home");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, emailVerified: true, studentMembership: { select: { id: true } } },
  });
  if (!user || user.studentMembership) redirect("/home");

  const match = await findDistrictMatch(user.email);
  if (match.kind !== "NEEDS_CAMPUS") redirect("/home");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-6 sm:p-10">
      <div className="rounded-3xl bg-surface-tint p-6 sm:p-8">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {match.organizationName}
        </p>
        <h1 className="mt-3 text-page-title text-balance">Which school do you go to?</h1>
        <p className="mt-2 text-muted-foreground">
          {match.organizationName} covers PrepHub Premium for its students. Pick your school and it switches on.
        </p>

        {match.campuses.length === 0 ? (
          <div className="mt-6 flex flex-col items-start gap-4">
            <p className="text-sm">
              Your district hasn&apos;t finished setting up its schools on PrepHub yet. Check back soon — nothing
              you do in the meantime is lost.
            </p>
            <LinkButton href="/home" variant="outline">
              Back to PrepHub
            </LinkButton>
          </div>
        ) : !user.emailVerified ? (
          <p className="mt-6 text-sm">Confirm your email first — the link is in your inbox.</p>
        ) : (
          <CampusForm campuses={match.campuses} />
        )}
      </div>
    </div>
  );
}
