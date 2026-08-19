import Link from "next/link";
import { UserRound } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canUseStudentExperience } from "@/lib/access";
import { getAccessSummary } from "@/lib/entitlements";
import { logOutAllDevicesAction } from "../actions";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <PageHeader icon={UserRound} title="Account settings" description="Manage your profile, goals, and how PrepHub reaches you." />

      {/* Appearance — a device/browser preference, not a student-specific
          feature, so it renders for every role (including Owner) rather
          than living inside the showStudentSections-gated block below. */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Separator />

      {showStudentSections && user && (
        <>
          {/* Profile */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {initials(user.firstName)}
                </div>
                <div>
                  <CardTitle>Profile</CardTitle>
                  <CardDescription>{session?.user.email}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ProfileForm firstName={user.firstName} />
              {membership?.status === "ACTIVE" && (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted-foreground">Verified school</dt>
                  <dd>{membership.school.officialName}</dd>
                  <dt className="text-muted-foreground">Graduation year</dt>
                  <dd>{membership.expectedGraduationYear}</dd>
                </dl>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Academic Goal */}
          <Card>
            <CardHeader>
              <CardTitle>Academic Goal</CardTitle>
              <CardDescription>Set a target SAT score to track your progress toward it.</CardDescription>
            </CardHeader>
            <CardContent>
              <TargetScoreForm currentTargetScore={user.targetScore} />
            </CardContent>
          </Card>

          <Separator />

          {/* Notifications */}
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
            </CardHeader>
            <CardContent>
              <NotificationsForm dailyReminderEnabled={user.dailyReminderEnabled} />
            </CardContent>
          </Card>

          <Separator />

          {/* Subscription — Administrators have inherent access (PRD-011 §7)
              and no personal subscription/billing of their own to manage. */}
          {!isAdmin && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Subscription</CardTitle>
                  {accessSummary?.type === "SCHOOL" && (
                    <CardDescription>Your access is provided by {accessSummary.organizationName}.</CardDescription>
                  )}
                  {accessSummary?.type === "INDIVIDUAL" && (
                    <CardDescription>
                      {accessSummary.subscription.plan ? PLAN_LABEL[accessSummary.subscription.plan] : "—"} —{" "}
                      {accessSummary.subscription.status}
                      {accessSummary.subscription.currentPeriodEnd &&
                        ` · renews ${accessSummary.subscription.currentPeriodEnd.toLocaleDateString()}`}
                    </CardDescription>
                  )}
                  {accessSummary?.type === "NONE" && <CardDescription>No active subscription.</CardDescription>}
                </CardHeader>
                <CardContent>
                  {accessSummary?.type === "SCHOOL" ? (
                    <p className="text-sm text-muted-foreground">
                      Billing is managed by your school or district, not by you directly.
                    </p>
                  ) : (
                    <LinkButton variant="outline" href="/billing">
                      Manage Billing
                    </LinkButton>
                  )}
                </CardContent>
              </Card>

              <Separator />
            </>
          )}

          {/* Legal */}
          <Card>
            <CardHeader>
              <CardTitle>Legal</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-4 text-sm">
              <Link href="/terms" className="underline">
                Terms of Service
              </Link>
              <Link href="/privacy" className="underline">
                Privacy Policy
              </Link>
            </CardContent>
          </Card>

          <Separator />
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>
            Log out of PrepHub on every device where you&apos;re currently signed in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={logOutAllDevicesAction}>
            <Button type="submit" variant="outline">
              Log out of all devices
            </Button>
          </form>
        </CardContent>
      </Card>

      <Separator />

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Delete account</CardTitle>
          <CardDescription>
            This permanently disables your account and removes personal information. Your
            practice history is retained for records but is no longer linked to identifying
            information. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccountForm hasPassword={Boolean(user?.passwordHash)} />
        </CardContent>
      </Card>
    </div>
  );
}
