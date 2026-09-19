import type { ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canUseStudentExperience } from "@/lib/access";
import { getAccessSummary } from "@/lib/entitlements";
import { getDashboardData } from "@/lib/dashboard/dashboard-data";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { logOutAllDevicesAction } from "../actions";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { cn } from "@/lib/utils";
import { DeleteAccountForm } from "./delete-account-form";
import { TargetScoreForm } from "./target-score-form";
import { ProfileForm } from "./profile-form";
import { NotificationsForm } from "./notifications-form";
import { ThemeToggle } from "./theme-toggle";
import { SettingsNav, type SettingsSectionLink } from "./settings-nav";

const PLAN_LABEL: Record<string, string> = { MONTHLY: "Monthly ($25/mo)", ANNUAL: "Annual ($99/yr)" };
const ROLE_LABEL: Record<string, string> = {
  STUDENT: "Student",
  SCHOOL_ADMINISTRATOR: "School Administrator",
  OWNER: "Owner",
};

function initials(firstName: string): string {
  return firstName.trim().slice(0, 2).toUpperCase();
}

function formatJoined(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// One settings section, the reference's shape: a heading and a one-line
// description, then one or more bordered cards. The heading row is what
// SettingsNav's IntersectionObserver watches, so every section needs its id.
function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-muted-foreground">{description}</p>
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border border-border p-6", className)}>{children}</div>;
}

// PRD-010 — Profile & Settings. Sections follow the PRD's §12 grouping order:
// Profile, Academic Goal, Notifications, Appearance, Subscription, Legal.
// The account-security pieces (Sessions, Delete account) are PRD-001
// material that predates this PRD and aren't in its scope, but they still
// belong on this page — grouped under "Account actions" at the end rather
// than removed.
export default async function SettingsPage() {
  const session = await auth();
  const role = session?.user.role ?? "STUDENT";
  const isStudent = role === "STUDENT";
  const isAdmin = role === "SCHOOL_ADMINISTRATOR";
  const showStudentSections = canUseStudentExperience(role);
  const userId = session?.user.id;

  const [user, membership, accessSummary, dashboard] = await Promise.all([
    userId
      ? prisma.user.findUnique({
          where: { id: userId },
          select: {
            passwordHash: true,
            targetScore: true,
            firstName: true,
            email: true,
            image: true,
            createdAt: true,
            dailyReminderEnabled: true,
          },
        })
      : null,
    isStudent && userId
      ? prisma.studentMembership.findUnique({
          where: { studentId: userId },
          select: { status: true, expectedGraduationYear: true, school: { select: { officialName: true } } },
        })
      : null,
    isStudent && userId ? getAccessSummary(userId) : null,
    // The profile card's stat tiles. Same source as the dashboard, so the two
    // can never disagree about a streak or a total.
    showStudentSections && userId ? getDashboardData(userId) : null,
  ]);

  // "Strongest category" is the reference's "Favorite subject" slot, filled
  // with something that is actually measured: the highest current mastery.
  // Null until the diagnostic exists, or if every category is still at zero.
  const strongest = dashboard?.mastery.reduce<{ category: string; value: number } | null>((best, m) => {
    if (m.currentMastery <= 0) return best;
    return !best || m.currentMastery > best.value ? { category: m.category, value: m.currentMastery } : best;
  }, null);

  const sections: SettingsSectionLink[] = [
    { id: "profile", label: "Profile" },
    ...(showStudentSections && user
      ? [
          { id: "goal", label: "Academic Goal" },
          { id: "notifications", label: "Notifications" },
        ]
      : []),
    { id: "appearance", label: "Appearance" },
    ...(showStudentSections && user && !isAdmin ? [{ id: "subscription", label: "Subscription" }] : []),
    ...(showStudentSections && user ? [{ id: "legal", label: "Legal" }] : []),
    { id: "account", label: "Account actions" },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl p-4 pb-16 sm:p-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[12rem_1fr] lg:gap-12">
        {/* The reference's left index. Sticky on desktop; below lg the page
            is short enough to scroll, so only the title remains. */}
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <h1 className="text-page-title sm:text-page-title-lg">Settings</h1>
          <div className="mt-6 hidden lg:block">
            <SettingsNav sections={sections} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-12">
          {/* Profile */}
          <Section id="profile" title="Profile" description="Your name, how to reach you, and where you stand.">
            <div className="overflow-hidden rounded-2xl border border-border">
              {/* The reference has an illustrated banner; ours is the
                  surface-deep band every other brand moment in the app uses,
                  with the avatar breaking its lower edge. */}
              <div className="h-24 bg-surface-deep" />
              <div className="px-6 pb-6">
                <div className="-mt-10 flex items-end gap-4">
                  {user?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.image}
                      alt=""
                      className="size-20 rounded-full bg-card object-cover ring-4 ring-card"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-20 items-center justify-center rounded-full bg-primary font-heading text-2xl font-semibold text-primary-foreground ring-4 ring-card"
                    >
                      {initials(user?.firstName ?? "")}
                    </span>
                  )}
                </div>

                <div className="mt-5 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(0,22rem)]">
                  <div className="min-w-0">
                    <p className="font-heading text-2xl font-semibold tracking-tight">{user?.firstName}</p>
                    <dl className="mt-4 flex flex-col divide-y divide-border border-y border-border text-sm">
                      <Row label="Email">{user?.email}</Row>
                      {user?.createdAt && <Row label="Joined">{formatJoined(user.createdAt)}</Row>}
                      <Row label="Role">{ROLE_LABEL[role] ?? role}</Row>
                      {isStudent && (
                        <Row label="Target score">
                          {user?.targetScore ?? <span className="text-muted-foreground">Not set</span>}
                        </Row>
                      )}
                      {membership?.status === "ACTIVE" && (
                        <>
                          <Row label="Verified school">{membership.school.officialName}</Row>
                          <Row label="Graduation year">{membership.expectedGraduationYear}</Row>
                        </>
                      )}
                    </dl>
                    {user && (
                      <div className="mt-6">
                        <ProfileForm firstName={user.firstName} />
                      </div>
                    )}
                  </div>

                  {/* Stat tiles — the reference's streak/time/subject grid,
                      with the four things this app actually measures. */}
                  {dashboard && (
                    <div className="grid grid-cols-2 gap-3 self-start">
                      <Tile label="Current streak" value={`${dashboard.studyStreak} day${dashboard.studyStreak === 1 ? "" : "s"}`} />
                      <Tile label="Questions answered" value={String(dashboard.totalQuestionsAnswered)} />
                      <Tile
                        label="Predicted score"
                        value={dashboard.currentRange ? `${dashboard.currentRange.min}–${dashboard.currentRange.max}` : "—"}
                      />
                      <Tile
                        label="Strongest category"
                        value={strongest ? CATEGORY_LABELS[strongest.category as keyof typeof CATEGORY_LABELS] : "—"}
                        small
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {showStudentSections && user && (
            <>
              {/* Academic Goal */}
              <Section id="goal" title="Academic Goal" description="Set a target SAT score to track your progress toward it.">
                <Card>
                  <TargetScoreForm currentTargetScore={user.targetScore} />
                </Card>
              </Section>

              {/* Notifications */}
              <Section id="notifications" title="Notifications" description="How PrepHub reminds you to practice.">
                <Card>
                  <NotificationsForm dailyReminderEnabled={user.dailyReminderEnabled} />
                </Card>
              </Section>
            </>
          )}

          {/* Appearance — a device/browser preference, not a student-specific
              feature, so it renders for every role (including Owner) rather
              than living inside the showStudentSections-gated block above. */}
          <Section id="appearance" title="Appearance" description="Light, dark, or follow this device. Applies to this browser only.">
            <Card>
              <ThemeToggle />
            </Card>
          </Section>

          {showStudentSections && user && (
            <>
              {/* Subscription — Administrators have inherent access (PRD-011 §7)
                  and no personal subscription/billing of their own to manage. */}
              {!isAdmin && (
                <Section id="subscription" title="Subscription" description="Review your current plan and manage your subscription.">
                  <Card className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    {accessSummary?.type === "SCHOOL" ? (
                      <div>
                        <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                          School access <CurrentPlanBadge />
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Your access is provided by {accessSummary.organizationName}. Billing is managed by your school
                          or district, not by you directly.
                        </p>
                      </div>
                    ) : accessSummary?.type === "INDIVIDUAL" ? (
                      <>
                        <div>
                          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                            {accessSummary.subscription.plan ? PLAN_LABEL[accessSummary.subscription.plan] : "Subscription"}
                            <CurrentPlanBadge />
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {accessSummary.subscription.status}
                            {accessSummary.subscription.currentPeriodEnd &&
                              ` · renews ${accessSummary.subscription.currentPeriodEnd.toLocaleDateString()}`}
                          </p>
                        </div>
                        <LinkButton variant="outline" className="shrink-0 rounded-full" href="/billing">
                          Manage Billing
                        </LinkButton>
                      </>
                    ) : (
                      <>
                        <div>
                          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                            Free plan <CurrentPlanBadge />
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            The Diagnostic and your baseline are free. Premium unlocks unlimited Personalized Practice
                            Sets.
                          </p>
                        </div>
                        <LinkButton className="shrink-0 rounded-full" href="/pricing">
                          View plans
                        </LinkButton>
                      </>
                    )}
                  </Card>
                </Section>
              )}

              {/* Legal */}
              <Section id="legal" title="Legal" description="The terms and privacy policy you agreed to when you signed up.">
                <Card className="flex gap-6 text-sm">
                  <Link href="/terms" className="underline underline-offset-4">
                    Terms of Service
                  </Link>
                  <Link href="/privacy" className="underline underline-offset-4">
                    Privacy Policy
                  </Link>
                </Card>
              </Section>
            </>
          )}

          {/* Account actions — the reference groups sign-out and deletion
              together at the end. Log out for *this* device lives in the
              sidebar; this is the every-device version. */}
          <Section id="account" title="Account actions" description="Sign out of every device, or permanently delete your account.">
            <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Log out of all devices</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ends every session where you&apos;re currently signed in, including this one.
                </p>
              </div>
              <form action={logOutAllDevicesAction}>
                <Button type="submit" variant="outline" className="rounded-full">
                  Log out of all devices
                </Button>
              </form>
            </Card>

            {/* The one irreversible control on the page keeps its own
                destructive-tinted card — conventional, not leftover chrome. */}
            <Card className="border-destructive/30 bg-destructive/[0.03]">
              <p className="font-medium text-destructive">Delete account</p>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                This permanently disables your account and removes personal information. Your practice history is
                retained for records but is no longer linked to identifying information. This cannot be undone.
              </p>
              <div className="mt-5 max-w-md">
                <DeleteAccountForm hasPassword={Boolean(user?.passwordHash)} />
              </div>
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function Tile({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-tint p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 font-heading font-semibold tracking-tight tabular-nums",
          small ? "text-base leading-snug" : "text-2xl",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function CurrentPlanBadge() {
  return (
    <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      Current plan
    </span>
  );
}
