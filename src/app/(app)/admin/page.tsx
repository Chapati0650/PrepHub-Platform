import Link from "next/link";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { getAdminOverviewData, getAdminSetupProgress } from "@/lib/admin/overview";
import {
  MIN_GROUP_SIZE,
  MIN_STUDENTS_FOR_SCORE_FIGURES,
  getCampusImpact,
  type CampusImpactReport,
  type ProtectedCount,
} from "@/lib/admin/impact";
import { formatContractDate, type SchoolAccessInfo, type SchoolAccessState } from "@/lib/admin/access-info";
import { getStudentDirectorySummary } from "@/lib/admin/student-directory";
import { campusesGuidedTotals, campusesHomeworkTotals, schoolGuidedTotals } from "@/lib/guided/queries";
import { SCHOOLS_CONTACT_EMAIL } from "@/components/marketing/site-chrome";
import {
  StaffHeader,
  StaffNote,
  StaffPage,
  StaffSection,
  StaffSteps,
  StaffUnavailable,
  StatStrip,
  StatusChip,
} from "@/components/staff/staff-ui";
import { DistrictCampusSwitcher, OwnerSchoolSwitcher } from "./school-switcher";
import { DistrictOverviewView } from "./district-overview";
import { getDistrictOverview } from "@/lib/admin/district-overview";
import { getGrowthByStudyTime } from "@/lib/admin/growth-by-time";
import { GrowthByTimeSection } from "./growth-by-time";
import { ReadinessSection } from "./readiness-section";
import { SkillGapsSection } from "./skill-gaps-section";
import { getDistrictSkillGaps, getSkillGaps } from "@/lib/admin/skill-gaps";
import { PrintButton } from "@/components/staff/print-button";

export const metadata = { title: "Overview" };

const ACCESS_STATE_LABELS: Record<SchoolAccessState, string> = {
  ACTIVE: "Active",
  NOT_STARTED: "Not started yet",
  ENDED: "Ended",
  PAUSED: "Paused",
  CLOSED: "Closed",
};

/** One sentence on whether students have Premium through the school, true to the derived state. */
function accessSentence(access: SchoolAccessInfo) {
  const from = <span className="font-medium">{formatContractDate(access.contractStartDate, "month")}</span>;
  const to = <span className="font-medium">{formatContractDate(access.contractEndDate, "month")}</span>;
  const through = access.providedBy ? ` through ${access.providedBy}` : " through your school";
  switch (access.state) {
    case "ACTIVE":
      return <>Students have Premium{through} from {from} to {to}.</>;
    case "NOT_STARTED":
      return <>Access{through} is planned from {from} to {to}. Students get Premium once it starts.</>;
    case "ENDED":
      return <>Access{through} ended in {to}. Students keep their accounts and history, but not Premium.</>;
    case "PAUSED":
      return <>Access{through} is paused, so students don&apos;t have Premium right now. Their accounts and history are kept.</>;
    case "CLOSED":
      return <>Access{through} has been closed.</>;
  }
}

/** A group's size in words, or "Fewer than 5" when it's small enough to point at someone. */
function groupSize(count: ProtectedCount): string {
  return count === null ? `Fewer than ${MIN_GROUP_SIZE}` : count.toLocaleString();
}

function formatGain(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

/** "45 min", "2 hr 30 min", "12 hr": rounding to whole hours showed one 30-minute session as "1 hr". */
function formatClassTime(totalMinutes: number): string {
  const m = Math.round(totalMinutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h >= 10 || rest === 0 ? `${Math.round(m / 60).toLocaleString()} hr` : `${h} hr ${rest} min`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

// PRD-011 §10 — the administrator's landing page (since 2026-10-25 the page an
// administrator signs in to). Rebuilt for the person reading it: a short
// "getting started" list while the school is new, then a handful of figures,
// each labelled with what it counts, instead of twenty identical boxes.
// Every figure is still a school total — the queries scope by
// StudentMembership, which an administrator never has, so their own practice
// is never in them (§7), and nothing here can name a student.
export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<{ school?: string }> }) {
  const { school } = await searchParams;
  const { schoolId, viewingAsOwner, availableSchools, district, carryCampusParam } = await requireAdminSchoolContext(school);

  // A district administrator with no campus chosen sees the whole district
  // and a row per campus; choosing a campus shows that campus's own overview.
  if (district && !schoolId) {
    const overview = await getDistrictOverview(district.name, district.campuses);
    // Only campuses whose own score figure is shown, like the district's average gain.
    const shown = overview.campuses.filter((c) => c.averageScoreGain !== null).map((c) => c.campusId);
    const ids = district.campuses.map((c) => c.id);
    const [growth, skills, guided, homework] = await Promise.all([
      getGrowthByStudyTime(shown),
      getDistrictSkillGaps(ids),
      campusesGuidedTotals(ids, 30),
      campusesHomeworkTotals(ids, 30),
    ]);
    return (
      <DistrictOverviewView overview={overview} campuses={district.campuses} growth={growth} skills={skills} teaching={{ guided, homework }} />
    );
  }

  if (!schoolId) return <StaffUnavailable title="The Overview isn't available for this account." />;

  // The student counts come from the Students page's own summary, so the two
  // pages can never disagree about how many have started or are active.
  const [data, impact, setup, students, guided, growthByTime, skillGaps] = await Promise.all([
    getAdminOverviewData(schoolId),
    getCampusImpact(schoolId),
    getAdminSetupProgress(schoolId),
    getStudentDirectorySummary(schoolId),
    schoolGuidedTotals(schoolId, 30),
    getGrowthByStudyTime([schoolId]),
    getSkillGaps(schoolId),
  ]);

  const { enrollment, stats } = data;
  const setupDone = setup.studentsJoined && setup.teachersAdded && setup.announcementPosted && setup.goalSet;
  const growth = impact.scoreGrowth;
  // The Owner's preview picks its school from the URL, so every link on the
  // page carries it — without it, one click landed back on the first school.
  // An Administrator's school comes from their assignment, so theirs stay bare.
  const href = (path: string) => (carryCampusParam ? `${path}?school=${schoolId}` : path);

  return (
    <StaffPage>
      {viewingAsOwner && <OwnerSchoolSwitcher basePath="/admin" schools={availableSchools} currentSchoolId={schoolId} />}
      {district && (
        <DistrictCampusSwitcher basePath="/admin" districtName={district.name} campuses={district.campuses} currentSchoolId={schoolId} allowAll />
      )}

      <StaffHeader
        eyebrow={district ? "Campus" : "Your school"}
        title={data.schoolName}
        description={`How PrepHub is going at ${district ? "this campus" : "your school"}. The numbers update as students practice. You see ${district ? "the campus's" : "your whole school's"} totals here; no student's scores are ever shown.`}
        actions={<PrintButton />}
      />

      {!setupDone && (
        <StaffSection
          title="Getting started"
          description="Four steps to set PrepHub up for your school. Each takes a few minutes, and this list disappears once they're all done."
        >
          <StaffSteps
            steps={[
              {
                title: "Get your students signed up",
                body: "Students create their own account with their school email. If your school gave PrepHub a student list, you can email everyone an invitation from the Students page.",
                done: setup.studentsJoined,
                href: href("/admin/students"),
                cta: "Go to Students",
              },
              {
                title: "Add your teachers",
                body: "Teachers make classes, give students a code to join, and assign homework.",
                done: setup.teachersAdded,
                href: href("/admin/teachers"),
                cta: "Add teachers",
              },
              {
                title: "Post a welcome announcement",
                body: "Tell students why your school is using PrepHub and where to start. It appears on their home page and goes to their inbox.",
                done: setup.announcementPosted,
                href: href("/admin/announcements"),
                cta: "Write one",
              },
              {
                title: "Set a school goal",
                body: "One target the whole school works toward together, with a prize if you'd like one.",
                done: setup.goalSet,
                href: href("/admin/goal"),
                cta: "Set a goal",
              },
            ]}
          />
        </StaffSection>
      )}

      <StaffSection title="At a glance">
        <StatStrip
          stats={[
            {
              label: "Students signed up",
              value: enrollment.registeredStudents.toLocaleString(),
              hint:
                enrollment.totalSchoolEnrollment !== null && enrollment.registrationPercentage !== null
                  ? `${enrollment.registrationPercentage}% of ${enrollment.totalSchoolEnrollment.toLocaleString()} enrolled are signed up now`
                  : "with their school email",
            },
            {
              label: "Have started practicing",
              value: (students.active - students.notStarted).toLocaleString(),
              hint: `answered at least one question · ${students.notStarted.toLocaleString()} haven't yet`,
            },
            {
              label: "Active this week",
              value: students.activeThisWeek.toLocaleString(),
              hint: "practiced in the last 7 days",
            },
            {
              label: "Questions answered",
              value: stats.totalQuestionsAnswered.toLocaleString(),
              // The hours and the per-student figure come from the same
              // sessions over the same students, so M × Y is about N.
              hint:
                impact.averageStudyHours !== null && impact.studentsWhoStudied > 0
                  ? `${plural(stats.totalStudyHours, "hour")} of study across ${plural(impact.studentsWhoStudied, "student")}, about ${impact.averageStudyHours} each`
                  : "all time, every kind of practice",
            },
          ]}
        />
        {enrollment.totalSchoolEnrollment === null && (
          <StaffNote>
            Your school&apos;s total enrollment isn&apos;t on file yet, so PrepHub can&apos;t show what share of students
            have signed up. Email{" "}
            <a href={`mailto:${SCHOOLS_CONTACT_EMAIL}`} className="font-medium underline underline-offset-4">
              {SCHOOLS_CONTACT_EMAIL}
            </a>{" "}
            with the number and we&apos;ll add it.
          </StaffNote>
        )}
      </StaffSection>

      <StaffSection
        title="Score growth"
        description="Each student's first predicted SAT score compared with their latest. Predictions are PrepHub estimates, not official College Board results."
      >
        {impact.measurableStudents === 0 ? (
          <StaffNote>
            Nothing to compare yet. A student needs to finish the Diagnostic and one Practice Set before their score
            change can be measured, and these figures appear once {MIN_STUDENTS_FOR_SCORE_FIGURES} students have.
          </StaffNote>
        ) : !growth ? (
          // Below the threshold an average or a "biggest gain" is one or two
          // students' own results, and the Students page says who has
          // finished a Practice Set (PRD-011 §21). How many qualify so far is
          // a count of who has practiced, which this area already shows.
          <StaffNote>
            Shown once {MIN_STUDENTS_FOR_SCORE_FIGURES} students have a second prediction to compare with their first, so
            no one student&apos;s score can be picked out. So far, {plural(impact.measurableStudents, "student")}{" "}
            {impact.measurableStudents === 1 ? "has" : "have"}.
          </StaffNote>
        ) : (
          <StatStrip
            stats={[
              {
                label: "Students improved",
                value: `${groupSize(growth.studentsImproved)} of ${impact.measurableStudents.toLocaleString()}`,
                hint: "predicted score went up",
              },
              {
                label: "Average gain",
                value: formatGain(growth.averageScoreGain),
                hint: "points, first prediction to latest",
              },
              {
                label: "Biggest gain",
                value: formatGain(growth.biggestScoreGain),
                hint: "points, one student's improvement",
              },
              {
                label: "Practice Sets finished",
                value: stats.totalAdaptiveSessionsCompleted.toLocaleString(),
                hint: "each one updates a student's prediction",
              },
            ]}
          />
        )}
      </StaffSection>

      {growth && <GrowthByTimeSection growth={growthByTime} measured={impact.measurableStudents} scope={district ? "this campus" : "your school"} />}

      <ReadinessSection benchmark={impact.benchmark} measured={impact.measurableStudents} />

      {impact.measurableStudents > 0 && <SkillGapsSection gaps={skillGaps} />}

      {guided.sessions > 0 && (
        <StaffSection
          title="Guided Sessions"
          description="Live, whole-class sessions your teachers ran from the front, in the last 30 days. Totals only; teachers see their own class's results."
        >
          <StatStrip
            columns={3}
            stats={[
              { label: "Sessions run", value: guided.sessions.toLocaleString() },
              { label: "Students who took part", value: guided.students.toLocaleString(), hint: "each counted once" },
              { label: "Class time", value: formatClassTime(guided.minutes), hint: "from Start to the end" },
            ]}
          />
        </StaffSection>
      )}

      <StaffSection
        title="Your school's access"
        action={
          <Link href={href("/admin/access")} className="text-base font-medium underline underline-offset-4">
            Access &amp; support
          </Link>
        }
      >
        <div className="flex flex-col gap-3 rounded-2xl border border-border p-5 text-base sm:flex-row sm:items-center sm:justify-between">
          <p>{accessSentence(data.access)}</p>
          <StatusChip tone={data.access.state === "ACTIVE" ? "good" : data.access.state === "PAUSED" || data.access.state === "NOT_STARTED" ? "warn" : "muted"}>
            {ACCESS_STATE_LABELS[data.access.state]}
          </StatusChip>
        </div>
        <Link href="/preview/premium" className="w-fit text-base font-medium underline underline-offset-4">
          See what a student sees when their access switches on
        </Link>
      </StaffSection>
    </StaffPage>
  );
}

