import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PremiumPreviewPlayer } from "./preview-player";

// The "your school covers Premium" moment, on demand (Owner request,
// 2026-10-25). A student sees it exactly once, so without this nobody who
// sells PrepHub to a district could ever show it. Nothing here writes: it
// renders the same component with a sample student's name and a no-op in
// place of recording that it was seen.
export default async function PremiumPreviewPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const role = session.user.role;
  if (role !== "OWNER" && role !== "SCHOOL_ADMINISTRATOR") redirect("/home");

  // An Administrator sees their own school's name and logo, as their
  // students will; the Owner sees a neutral placeholder.
  const assignment =
    role === "SCHOOL_ADMINISTRATOR"
      ? await prisma.administratorAssignment.findFirst({
          where: { userId: session.user.id, removedAt: null, organization: { organizationType: "SCHOOL" } },
          select: { organization: { select: { officialName: true, logoMediaId: true, parentDistrict: { select: { officialName: true, logoMediaId: true } } } } },
        })
      : null;
  // A district student's moment names the district, which is who pays.
  const payer = assignment?.organization.parentDistrict ?? assignment?.organization ?? null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4 pb-16 sm:p-8">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-8">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Preview</p>
        <h1 className="mt-3 text-page-title text-balance">What a student sees when Premium switches on</h1>
        <p className="mt-3 text-muted-foreground">
          The moment a student&apos;s school email is confirmed, this plays once, on the first page they open. This is a
          preview with a sample student&apos;s name; nothing is recorded.
        </p>
        <div className="mt-6">
          <PremiumPreviewPlayer
            organizationName={payer?.officialName ?? "Your School District"}
            logoMediaId={payer?.logoMediaId ?? null}
          />
        </div>
      </section>
      <Link href={role === "OWNER" ? "/home" : "/admin"} className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
    </div>
  );
}
