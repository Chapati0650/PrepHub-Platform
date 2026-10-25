import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAccessContext, hasActiveSchoolEntitlement, hasPaidAccess } from "@/lib/entitlements";
import { catchUpDistrictEnrollment } from "@/lib/district/enrollment";
import { prisma } from "@/lib/prisma";
import { logoutAction, markPremiumCelebratedAction } from "./actions";
import { resendDistrictVerificationAction } from "./access/actions";
import { AppShell } from "@/components/app-shell";

// PRD-000's primary nav for students (Home/Practice/Progress/Profile) — also
// shown to School Administrators (PRD-011 §6: "the account receives all
// standard student navigation and an additional administrator-only area"),
// so this creates one unified product rather than separate apps. The Owner
// gets its own short nav (Schools/Content/Account) — without it there was no
// clickable path out of the bare Owner /home placeholder into /owner/schools
// or /owner/content at all. Once inside /owner/content, its own sub-nav
// (src/app/(app)/owner/content/layout.tsx) handles the Questions/Question
// Families/Content Coverage tabs. The actual nav chrome (persistent left
// sidebar on desktop, slide-out sheet on mobile) lives in AppShell — a
// client component, since active-link highlighting needs usePathname() —
// this file stays a server component so the session check happens here.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Defense in depth alongside src/middleware.ts — every server-rendered page
  // under (app) independently confirms a session before rendering anything.
  // Checks session.user.id specifically, not just the bare session.user
  // object: a just-deleted account's jwt callback returns an empty token
  // (see src/auth.ts), which Auth.js still surfaces as a truthy — but
  // id-less — session.user for that one stale request. Every child page's
  // own data fetch assumes session.user.id is a real, queryable id, so this
  // must catch the id-less case, not just an absent session (see the same
  // pattern in src/app/page.tsx).
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const role = session.user.role ?? "STUDENT";

  // District enrollment is caught up here, in the layout, rather than in a
  // page. It has to happen before `showUpgrade` is computed and it must be
  // somewhere every authenticated route passes through.
  //
  // Doing it in the page body was wrong in a way that only showed up in a
  // browser: the layout had already read the access context — React-cached,
  // so a write the page made afterwards was invisible to it — and rendered
  // "Upgrade · 50% off" in the sidebar while the page beside it rendered the
  // student's full paid access. It corrected itself on the next navigation,
  // but a district student's very first screen is exactly where an upgrade
  // prompt must never appear.
  //
  // It also says what, if anything, the student still has to do — confirm
  // their email, or pick their campus — which the shell shows in its top bar.
  const district = role === "STUDENT" ? await catchUpDistrictEnrollment(session.user.id) : null;
  const districtPrompt = district?.prompt ?? null;

  // The shell's Upgrade row and launch-pricing banner are purely
  // presentational — nothing behind them is gated here — but they must still
  // agree with the real entitlement, so the answer comes from the one
  // entitlement service (CLAUDE.md invariant) rather than a second guess.
  // Only students can be unpaid: administrators have inherent access and
  // the Owner never buys the product.
  //
  // A student one step from their school's free access is not shown a price
  // at all: offering to sell them what their school already pays for is the
  // mistake the district bar exists to prevent.
  const oneStepFromSchoolAccess = districtPrompt?.kind === "CONFIRM_EMAIL" || districtPrompt?.kind === "PICK_CAMPUS";
  const [paid, classEnrollment] = await Promise.all([
    role === "STUDENT" ? hasPaidAccess(session.user.id) : true,
    // Homework appears in the nav only for a student who is in a class: for
    // everyone studying on their own it would be a dead item.
    role === "STUDENT"
      ? prisma.classroomEnrollment.findFirst({
          where: { studentId: session.user.id, removedAt: null, classroom: { archivedAt: null } },
          select: { id: true },
        })
      : null,
  ]);
  const showUpgrade = role === "STUDENT" && !paid && !oneStepFromSchoolAccess;

  // The school providing this student's access, for the sidebar. Free: it
  // comes from the same cached context the entitlement decision already read,
  // so no extra query. Only an ACTIVE membership counts — a removed or
  // graduated one should stop branding the product.
  const { membership } = await getAccessContext(session.user.id);
  const provider =
    membership?.status === "ACTIVE"
      ? { name: membership.organization.officialName, logoMediaId: membership.organization.logoMediaId }
      : null;

  // The once-per-student "your school covers Premium" moment. Only while the
  // entitlement is genuinely live — a membership whose contract hasn't
  // started grants nothing, so celebrating it would be a lie.
  const celebration =
    role === "STUDENT" && membership && !membership.celebratedAt && hasActiveSchoolEntitlement(membership)
      ? {
          organizationName: membership.organization.officialName,
          logoMediaId: membership.organization.logoMediaId,
          firstName: session.user.name ?? null,
        }
      : null;

  return (
    <AppShell
      role={role}
      user={{ name: session.user.name ?? "", email: session.user.email ?? "" }}
      showUpgrade={showUpgrade}
      provider={provider}
      districtPrompt={districtPrompt}
      resendVerification={resendDistrictVerificationAction}
      celebration={celebration}
      markCelebrated={markPremiumCelebratedAction}
      showHomework={Boolean(classEnrollment)}
      logoutAction={logoutAction}
    >
      {children}
    </AppShell>
  );
}
