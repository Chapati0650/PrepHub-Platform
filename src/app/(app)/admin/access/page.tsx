import { Mail } from "lucide-react";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { OwnerSchoolSwitcher } from "../school-switcher";
import { formatContractDate, getSchoolAccessInfo, type SchoolAccessState } from "@/lib/admin/access-info";
import { SCHOOLS_CONTACT_EMAIL } from "@/components/marketing/site-chrome";
import { buttonVariants } from "@/components/ui/button";
import { StaffHeader, StaffPage, StaffSection, StaffUnavailable, StatusChip } from "@/components/staff/staff-ui";

// Keyed by the state derived from the organization that pays (access-info.ts),
// not the campus row's own status, which can lag the district's by a year.
const ACCESS_STATE: Record<SchoolAccessState, { label: string; tone: "good" | "warn" | "muted"; meaning: string }> = {
  NOT_STARTED: {
    label: "Not started yet",
    tone: "warn",
    meaning: "PrepHub is getting your school ready. Students get Premium once access starts.",
  },
  ACTIVE: { label: "Active", tone: "good", meaning: "Students who sign up with their school email have Premium, free." },
  ENDED: {
    label: "Ended",
    tone: "muted",
    meaning: "The access period is over. Students keep their accounts and history, but not Premium.",
  },
  PAUSED: {
    label: "Paused",
    tone: "warn",
    meaning: "Access is paused. Students keep their accounts and history. Email us to find out more.",
  },
  CLOSED: { label: "Closed", tone: "muted", meaning: "This school's PrepHub access has been closed." },
};

const DAY_MS = 24 * 60 * 60 * 1000;

// PRD-011 §19-§20 — whether the school's access is on and until when, plus
// how to reach PrepHub. Deliberately no contract amount, invoices or other
// billing detail: "the dashboard does not function as a billing or
// contract-management portal."
export default async function SchoolAccessPage({ searchParams }: { searchParams: Promise<{ school?: string }> }) {
  const { school } = await searchParams;
  const { schoolId, viewingAsOwner, availableSchools } = await requireAdminSchoolContext(school);

  if (!schoolId) return <StaffUnavailable title="Access & support isn't available for this account." />;

  const info = await getSchoolAccessInfo(schoolId);
  const status = ACCESS_STATE[info.state];
  const now = new Date();
  const daysLeft = Math.ceil((new Date(info.contractEndDate).getTime() - now.getTime()) / DAY_MS);
  const subject = encodeURIComponent(`PrepHub help: ${info.schoolName}`);

  return (
    <StaffPage>
      {viewingAsOwner && (
        <OwnerSchoolSwitcher basePath="/admin/access" schools={availableSchools} currentSchoolId={schoolId} />
      )}

      <StaffHeader
        eyebrow="Your school"
        title="Access & support"
        description="Whether your students have PrepHub Premium through the school, until when, and how to reach a person at PrepHub."
      />

      <StaffSection title="Your school's access">
        <div className="flex flex-col gap-4 rounded-2xl border border-border p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
            <p className="text-base">{status.meaning}</p>
          </div>
          {info.providedBy && (
            <p className="text-base text-muted-foreground">
              Your school&apos;s access comes through {info.providedBy}, so these are the district&apos;s dates.
            </p>
          )}
          <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
            <div className="bg-background p-4">
              <dt className="text-base font-medium">Starts</dt>
              <dd className="mt-1 font-heading text-2xl font-semibold tracking-tight">{formatContractDate(info.contractStartDate)}</dd>
            </div>
            <div className="bg-background p-4">
              <dt className="text-base font-medium">Ends</dt>
              <dd className="mt-1 font-heading text-2xl font-semibold tracking-tight">{formatContractDate(info.contractEndDate)}</dd>
              {info.state === "ACTIVE" && daysLeft > 0 && (
                <dd className="mt-1 text-sm text-muted-foreground">
                  {daysLeft === 1 ? "Tomorrow" : `In ${daysLeft.toLocaleString()} days`}
                </dd>
              )}
            </div>
          </dl>
          <p className="text-base text-muted-foreground">
            When access ends, students keep their accounts and everything they&apos;ve done; only Premium stops. Seniors
            lose school access on July 1 of their graduation year.
          </p>
        </div>
      </StaffSection>

      <StaffSection
        title="Get help from PrepHub"
        description="Email us about anything you can't fix here."
      >
        <div className="flex flex-col gap-5 rounded-2xl border border-border p-5 sm:p-6">
          <div>
            <p className="text-base font-medium">We can help with:</p>
            <ul className="mt-2 grid gap-x-8 gap-y-1.5 text-base text-muted-foreground sm:grid-cols-2">
              <li>A student who can&apos;t sign in or doesn&apos;t have Premium</li>
              <li>A wrong student email or school</li>
              <li>Adding or correcting your enrollment number</li>
              <li>Announcements that didn&apos;t arrive</li>
              <li>Teacher or administrator accounts</li>
              <li>Anything else that isn&apos;t working</li>
            </ul>
          </div>
          <p className="text-base text-muted-foreground">
            It helps to include the student&apos;s school email and what they see on their screen.
          </p>
          <a href={`mailto:${SCHOOLS_CONTACT_EMAIL}?subject=${subject}`} className={buttonVariants({ size: "xl", className: "w-fit" })}>
            <Mail aria-hidden />
            Email {SCHOOLS_CONTACT_EMAIL}
          </a>
        </div>
      </StaffSection>
    </StaffPage>
  );
}
