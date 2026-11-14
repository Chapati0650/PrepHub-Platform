import Link from "next/link";
import { DistrictCampusSwitcher, PickCampusPrompt } from "../school-switcher";
import { Download } from "lucide-react";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { OwnerSchoolSwitcher } from "../school-switcher";
import {
  getStudentDirectory,
  parseDirectoryFilters,
  getStudentDirectorySummary,
  graduationYearWindow,
  type DirectoryActivityFilter,
  type StudentDirectoryFilters,
  type StudentDirectorySummary,
} from "@/lib/admin/student-directory";
import { getSchoolAccessInfo } from "@/lib/admin/access-info";
import { previewReminderAudience } from "@/lib/admin/student-reminders";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getRosterInviteSummary, inviteScopeForSchool } from "@/lib/owner/roster-invites";
import { buttonVariants } from "@/components/ui/button";
import { StaffHeader, StaffPage, StaffUnavailable } from "@/components/staff/staff-ui";
import { cn } from "@/lib/utils";
import { StudentDirectoryTable } from "./student-directory-table";
import { CampusInvitePanel } from "./invite-panel";

export const metadata = { title: "Students" };

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The list's filters (and the campus, where links carry it) as a query string, without the page. */
function filtersQueryString(filters: StudentDirectoryFilters, schoolParam: string): string {
  const q = new URLSearchParams();
  if (filters.search) q.set("search", filters.search);
  if (filters.graduationYear) q.set("graduationYear", String(filters.graduationYear));
  if (filters.status) q.set("status", filters.status);
  if (filters.activity) q.set("activity", filters.activity);
  const query = q.toString();
  return [query, schoolParam].filter(Boolean).join("&");
}

// PRD-011 §12-§14 — the administrator's list of registered students: who has
// signed up, how much each has practiced, and who needs a nudge. Filters live
// in the URL so a filtered list is a link that can be bookmarked or shared.
export default async function StudentDirectoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { schoolId, viewingAsOwner, availableSchools, district, carryCampusParam } = await requireAdminSchoolContext(one(params.school));

  if (district && !schoolId) {
    return <PickCampusPrompt basePath="/admin/students" districtName={district.name} campuses={district.campuses} what="The student list" />;
  }
  if (!schoolId) return <StaffUnavailable title="The student list isn't available for this account." />;

  const filters = parseDirectoryFilters(params);
  // "Remind them" on the Overview lands here with `compose=1`: the composer
  // opens on arrival, already counted, so the administrator is one press from
  // sending rather than three clicks from finding the button.
  const composeOnLoad = one(params.compose) === "1" && !viewingAsOwner;
  const session = await auth();
  const [directory, invites, summary, access, school, sender, composePreview] = await Promise.all([
    getStudentDirectory(schoolId, filters),
    inviteScopeForSchool(schoolId).then((scope) => getRosterInviteSummary(scope)),
    getStudentDirectorySummary(schoolId),
    getSchoolAccessInfo(schoolId),
    prisma.organization.findUnique({ where: { id: schoolId }, select: { officialName: true } }),
    session?.user?.id ? prisma.user.findUnique({ where: { id: session.user.id }, select: { firstName: true } }) : null,
    composeOnLoad ? previewReminderAudience(schoolId, { kind: "filter", filters }).then((preview) => ({ preview })) : null,
  ]);
  const currentYear = new Date().getFullYear();
  const schoolParam = carryCampusParam ? `school=${schoolId}` : "";
  const schoolName = school?.officialName ?? "your school";

  return (
    <StaffPage>
      {district && (
        <DistrictCampusSwitcher basePath="/admin/students" districtName={district.name} campuses={district.campuses} currentSchoolId={schoolId} />
      )}
      {viewingAsOwner && (
        <OwnerSchoolSwitcher basePath="/admin/students" schools={availableSchools} currentSchoolId={schoolId} />
      )}

      {/* The description states the boundary out loud, because an
          administrator seeing engagement columns will reasonably wonder
          whether scores are here too, and a student deserves to be able to
          read the same sentence. */}
      <StaffHeader
        eyebrow={schoolName}
        title="Students"
        description="Everyone who signed up through your school, how much each has practiced, and who could use a nudge. You see effort, never scores: no student's answers, mastery or predicted score appears here."
        actions={
          // A plain link, not a client navigation: the browser downloads the file.
          <a
            href={`/admin/students/export${schoolParam ? `?${schoolParam}` : ""}`}
            className={cn(buttonVariants({ variant: "outline", size: "xl" }), "bg-background")}
          >
            <Download aria-hidden />
            Download everyone
          </a>
        }
      />

      <ActivitySummary
        summary={summary}
        filters={filters}
        schoolParam={schoolParam}
        accessLive={access.state === "ACTIVE"}
      />

      <CampusInvitePanel summary={invites} readOnly={viewingAsOwner} campusId={district ? (schoolId ?? undefined) : undefined} />

      <StudentDirectoryTable
        students={directory.entries}
        total={directory.total}
        page={directory.page}
        pageCount={directory.pageCount}
        filters={filters}
        filtersQuery={filtersQueryString(filters, schoolParam)}
        currentYear={currentYear}
        classYears={graduationYearWindow()}
        schoolName={schoolName}
        senderName={sender?.firstName ?? "Your school"}
        composeOnLoad={composeOnLoad}
        composePreview={composePreview}
      />
    </StaffPage>
  );
}

const SUMMARY_GROUPS: {
  activity: DirectoryActivityFilter | null;
  label: string;
  value: (s: StudentDirectorySummary) => number;
  hint: (s: StudentDirectorySummary, accessLive: boolean) => string;
}[] = [
  {
    activity: null,
    label: "Signed up",
    value: (s) => s.registered,
    // "With access" only while the school's access is actually on; an
    // ACTIVE membership under a paused or ended contract grants nothing.
    hint: (s, accessLive) => `${s.active.toLocaleString()} ${accessLive ? "with access right now" : "still enrolled"}`,
  },
  { activity: "ACTIVE_THIS_WEEK", label: "Active this week", value: (s) => s.activeThisWeek, hint: () => "practiced in the last 7 days" },
  { activity: "NOT_STARTED", label: "Haven't started yet", value: (s) => s.notStarted, hint: () => "signed up, no questions answered" },
  { activity: "GONE_QUIET", label: "Gone quiet", value: (s) => s.goneQuiet, hint: () => "started, then nothing for 2 weeks" },
];

/**
 * The four numbers an administrator asks first, each one a link that filters
 * the list below to exactly those students — "who hasn't started?" is one
 * click, not a filter to learn.
 *
 * The three activity counts are over students enrolled now, so their links
 * carry `status=ACTIVE` too: without it "Haven't started yet: 37" opened a
 * list of 52 that included last year's graduates. "Signed up" counts every
 * status and opens the unfiltered list.
 */
function ActivitySummary({
  summary,
  filters,
  schoolParam,
  accessLive,
}: {
  summary: StudentDirectorySummary;
  filters: StudentDirectoryFilters;
  schoolParam: string;
  accessLive: boolean;
}) {
  const otherFilters = Boolean(filters.search || filters.graduationYear);
  return (
    <nav aria-label="Show students by activity">
      <ul className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {SUMMARY_GROUPS.map((g) => {
          const selected =
            !otherFilters &&
            (g.activity
              ? filters.activity === g.activity && filters.status === "ACTIVE"
              : !filters.activity && !filters.status);
          const query = [g.activity ? `activity=${g.activity}&status=ACTIVE` : "", schoolParam].filter(Boolean).join("&");
          return (
            <li key={g.label} className="flex">
              <Link
                href={`/admin/students${query ? `?${query}` : ""}`}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "flex w-full flex-col p-6 transition-colors",
                  selected ? "bg-surface-tint" : "bg-background hover:bg-muted/50",
                )}
              >
                <span className="text-base font-medium text-foreground/80">{g.label}</span>
                <span className="mt-2 font-heading text-4xl font-semibold tracking-tight tabular-nums">
                  {g.value(summary).toLocaleString()}
                </span>
                <span className="mt-1.5 text-base leading-snug text-muted-foreground">{g.hint(summary, accessLive)}</span>
                <span className={cn("mt-auto pt-4 text-base font-medium", selected ? "text-primary dark:text-marker" : "text-foreground/70")}>
                  {selected ? "Showing these below" : g.activity ? "Show these students →" : "Show everyone →"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
