import type { ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canUseStudentExperience } from "@/lib/access";
import { getAccessSummary } from "@/lib/entitlements";
import { logOutAllDevicesAction } from "../actions";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { PageHeader } from "@/components/page-header";
import { DeleteAccountForm } from "./delete-account-form";
import { TargetScoreForm } from "./target-score-form";
import { ProfileForm } from "./profile-form";
import { NotificationsForm } from "./notifications-form";
import { ThemeToggle } from "./theme-toggle";

const PLAN_LABEL: Record<string, string> = { MONTHLY: "Monthly ($25/mo)", ANNUAL: "Annual ($99/yr)" };

function initials(firstName: string): string {
  return firstName.trim().slice(0, 2).toUpperCase();
}

// One settings section: its name and explanation on the left, the control on
// the right, with a rule between sections.
//
// Replaces a stack of <Card>s each separated by a <Separator>. That was two
// kinds of chrome doing one job — every section was simultaneously boxed and
// ruled off — and it gave a page of small toggles the same visual weight as a
// dashboard of real content. A label column and a hairline is the settings
// pattern in every product this app is aiming at, and it also puts the actual
// controls in one aligned column instead of scattering them across eight boxes.
function SettingsSection({
  title,
  description,
  children,
  titleClassName,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  titleClassName?: string;
}) {
  return (
    <section className="grid grid-cols-1 gap-x-8 gap-y-4 border-b border-border py-8 first:pt-0 sm:grid-cols-[minmax(0,14rem)_1fr]">
      <div>
        <h2 className={`font-medium ${titleClassName ?? ""}`}>{title}</h2>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      </div>
      {/* Capped: without a max width every input and the destructive button
          stretched the full content column, which made a page of small
          controls look like a page of full-bleed form fields. */}
      <div className="min-w-0 max-w-md">{children}</div>
    </section>
  );
}

// PRD-010 — Profile & Settings. Sections follow the PRD's §12 grouping order:
// Profile, Academic Goal, Notifications, Appearance, Subscription, Legal.
// The account-security pieces (Sessions, Delete account) are PRD-001
// material that predates this PRD and aren't in its scope, but they still
// belong on this page — kept below the PRD-010 sections rather than removed.
export default async function SettingsPage() {
  const session = await auth();
  const isStudent = session?.user.role === "STUDENT";
  const isAdmin = session?.user.role === "SCHOOL_ADMINISTRATOR";
  const showStudentSections = canUseStudentExperience(session?.user.role);

  const [user, membership, accessSummary] = await Promise.all([
    session?.user.id
      ? prisma.user.findUnique({
          where: { id: session.user.id },
          select: { passwordHash: true, targetScore: true, firstName: true, dailyReminderEnabled: true },
        })
      : null,
    isStudent && session?.user.id
      ? prisma.studentMembership.findUnique({
          where: { studentId: session.user.id },
          select: { status: true, expectedGraduationYear: true, school: { select: { officialName: true } } },
        })
      : null,
    isStudent && session?.user.id ? getAccessSummary(session.user.id) : null,
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <PageHeader title="Account settings" description="Manage your profile, goals, and how PrepHub reaches you." />

      <div className="flex flex-col">
        {showStudentSections && user && (
          <>
            {/* Profile */}
            <SettingsSection
              title="Profile"
              description={
                <span className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[0.7rem] font-semibold text-primary-foreground">
                    {initials(user.firstName)}
                  </span>
                  <span className="truncate">{session?.user.email}</span>
                </span>
              }
            >
              <div className="flex flex-col gap-5">
                <ProfileForm firstName={user.firstName} />
                {membership?.status === "ACTIVE" && (
                  <dl className="flex flex-col divide-y divide-border border-t border-border text-sm">
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-muted-foreground">Verified school</dt>
                      <dd className="text-right">{membership.school.officialName}</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-muted-foreground">Graduation year</dt>
                      <dd className="text-right tabular-nums">{membership.expectedGraduationYear}</dd>
                    </div>
                  </dl>
                )}
              </div>
            </SettingsSection>

            {/* Academic Goal */}
            <SettingsSection
              title="Academic Goal"
              description="Set a target SAT score to track your progress toward it."
            >
              <TargetScoreForm currentTargetScore={user.targetScore} />
            </SettingsSection>

            {/* Notifications */}
            <SettingsSection title="Notifications" description="How PrepHub reminds you to practice.">
              <NotificationsForm dailyReminderEnabled={user.dailyReminderEnabled} />
            </SettingsSection>
          </>
        )}

        {/* Appearance — a device/browser preference, not a student-specific
            feature, so it renders for every role (including Owner) rather
            than living inside the showStudentSections-gated block above. */}
        <SettingsSection title="Appearance" description="Applies to this browser only.">
          <ThemeToggle />
        </SettingsSection>

        {showStudentSections && user && (
          <>
            {/* Subscription — Administrators have inherent access (PRD-011 §7)
                and no personal subscription/billing of their own to manage. */}
            {!isAdmin && (
              <SettingsSection
                title="Subscription"
                description={
                  accessSummary?.type === "SCHOOL" ? (
                    <>Your access is provided by {accessSummary.organizationName}.</>
                  ) : accessSummary?.type === "INDIVIDUAL" ? (
                    <>
                      {accessSummary.subscription.plan ? PLAN_LABEL[accessSummary.subscription.plan] : "—"} —{" "}
                      {accessSummary.subscription.status}
                      {accessSummary.subscription.currentPeriodEnd &&
                        ` · renews ${accessSummary.subscription.currentPeriodEnd.toLocaleDateString()}`}
                    </>
                  ) : (
                    <>No active subscription.</>
                  )
                }
              >
                {accessSummary?.type === "SCHOOL" ? (
                  <p className="text-sm text-muted-foreground">
                    Billing is managed by your school or district, not by you directly.
                  </p>
                ) : (
                  <LinkButton variant="outline" href="/billing">
                    Manage Billing
                  </LinkButton>
                )}
              </SettingsSection>
            )}

            {/* Legal */}
            <SettingsSection title="Legal">
              <div className="flex gap-5 text-sm">
                <Link href="/terms" className="underline underline-offset-4">
                  Terms of Service
                </Link>
                <Link href="/privacy" className="underline underline-offset-4">
                  Privacy Policy
                </Link>
              </div>
            </SettingsSection>
          </>
        )}

        <SettingsSection
          title="Sessions"
          description="Log out of PrepHub on every device where you're currently signed in."
        >
          <form action={logOutAllDevicesAction}>
            <Button type="submit" variant="outline">
              Log out of all devices
            </Button>
          </form>
        </SettingsSection>

        {/* Deliberately still visually separated from everything above it —
            this is the one irreversible control on the page, and the red
            heading plus its own tinted block is the conventional signal for
            that, not leftover card chrome. */}
        <SettingsSection
          title="Delete account"
          titleClassName="text-destructive"
          description="This permanently disables your account and removes personal information. Your practice history is retained for records but is no longer linked to identifying information. This cannot be undone."
        >
          <DeleteAccountForm hasPassword={Boolean(user?.passwordHash)} />
        </SettingsSection>
      </div>
    </div>
  );
}
