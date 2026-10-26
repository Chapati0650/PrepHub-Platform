import type { MembershipStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import { cacheAcrossRequests } from "@/lib/shared-cache";
import { graduationCutoffYear } from "@/lib/owner/graduation";
import {
  emptyStudentActivity,
  getStudentActivity,
  lastAnsweredAtForSchool,
  type StudentActivity,
} from "@/lib/school/student-activity";
import { AdminError } from "./errors";

/**
 * The questions an administrator actually asks of the list: who hasn't
 * started, who's practicing now, and who started and then stopped.
 */
export type DirectoryActivityFilter = "NOT_STARTED" | "ACTIVE_THIS_WEEK" | "GONE_QUIET";

export const DIRECTORY_ACTIVITY_FILTERS: readonly DirectoryActivityFilter[] = ["NOT_STARTED", "ACTIVE_THIS_WEEK", "GONE_QUIET"];

/** Every membership status, for checking a `?status=` value rather than trusting it. */
export const MEMBERSHIP_STATUSES: readonly MembershipStatus[] = ["ACTIVE", "REMOVED", "GRADUATED"];

export type StudentDirectoryFilters = {
  search?: string;
  graduationYear?: number;
  status?: MembershipStatus;
  activity?: DirectoryActivityFilter;
  /** 1-based. Out-of-range values are clamped rather than erroring. */
  page?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Active this week" looks back 7 days; "gone quiet" means nothing in 14. */
const ACTIVE_WINDOW_DAYS = 7;
const QUIET_AFTER_DAYS = 14;

/**
 * Whether a student whose last answer was at `lastAnsweredAt` (undefined: never)
 * is in an activity group. Pure, and the one definition both the summary
 * counts and the filtered list are read from, so a count and the list it
 * links to can't disagree about who is in it.
 */
export function matchesActivity(filter: DirectoryActivityFilter, lastAnsweredAt: Date | undefined, now: Date): boolean {
  if (!lastAnsweredAt) return filter === "NOT_STARTED";
  if (filter === "NOT_STARTED") return false;
  const since = now.getTime() - lastAnsweredAt.getTime();
  if (filter === "ACTIVE_THIS_WEEK") return since <= ACTIVE_WINDOW_DAYS * DAY_MS;
  return since > QUIET_AFTER_DAYS * DAY_MS;
}

/**
 * Rows per page.
 *
 * The directory used to return every membership at the school. That is fine
 * for a pilot campus and unusable for a district: a 2,000-student school meant
 * 2,000 rows fetched, three more unbounded queries to derive last-active, and
 * 2,000 table rows rendered into the HTML. Paging bounds all four.
 */
export const STUDENT_DIRECTORY_PAGE_SIZE = 50;

export type StudentDirectoryEntry = {
  membershipId: string;
  firstName: string;
  schoolEmail: string;
  graduationYear: number;
  status: MembershipStatus;
  registeredAt: Date;
  lastActiveAt: Date | null;
  /** Engagement, not performance — see the note below. */
  activity: StudentActivity;
};

// PRD-011 §12 — the directory's field list is account/administrative metadata
// plus engagement: how many questions a student has answered, how many
// sessions they finished, roughly how long they have spent, and when they were
// last here.
//
// The line this holds, and the reason it is drawn where it is: an
// Administrator sees *how much work* a student has done and never *how well*
// they did it. No correctness, ability, mastery or predicted-score field is
// selected out of the database anywhere in this file, which is a stronger
// guarantee than filtering one out later (§21 — the dashboard must not let an
// admin reverse-engineer performance from what's shown). PRD-011 §7 originally
// excluded engagement too; it was added on 2026-10-21 after an administrator
// asked for it directly, because "has this student even started?" is the
// question an intervention actually turns on. Per-student *scores* remain a
// separate decision and are deliberately not implied by this one.
export type StudentDirectoryPage = {
  entries: StudentDirectoryEntry[];
  total: number;
  page: number;
  pageCount: number;
};

export async function getStudentDirectory(
  schoolId: string,
  filters: StudentDirectoryFilters = {},
  now: Date = new Date(),
): Promise<StudentDirectoryPage> {
  const where: Prisma.StudentMembershipWhereInput = {
    schoolId,
    ...(filters.graduationYear ? { expectedGraduationYear: filters.graduationYear } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search
      ? {
          OR: [
            { student: { firstName: { contains: filters.search, mode: "insensitive" } } },
            { verifiedSchoolEmail: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  // With an activity filter the matching set can only be known after asking
  // about every candidate's activity, so the ids are narrowed first and the
  // page is cut from what's left. Without one, the database counts and pages
  // as before.
  let pageWhere: Prisma.StudentMembershipWhereInput = where;
  let total: number;
  let narrowedIds: string[] | null = null;
  if (filters.activity) {
    // Activity lives in seven answer tables, not on the membership. One read
    // of every student's last answer at this school (scoped by a membership
    // join, not a list of ids) answers the filter for all of them at once.
    const activity = filters.activity;
    const [candidates, lastAnswered] = await Promise.all([
      prisma.studentMembership.findMany({
        where,
        select: { id: true, studentId: true },
        orderBy: { activatedAt: "desc" },
      }),
      lastAnsweredAtForSchool(schoolId, { activeOnly: false }),
    ]);
    narrowedIds = candidates
      .filter((c) => matchesActivity(activity, lastAnswered.get(c.studentId), now))
      .map((c) => c.id);
    total = narrowedIds.length;
  } else {
    total = await prisma.studentMembership.count({ where });
  }
  const pageCount = Math.max(1, Math.ceil(total / STUDENT_DIRECTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1)), pageCount);
  const offset = (page - 1) * STUDENT_DIRECTORY_PAGE_SIZE;
  if (narrowedIds) {
    pageWhere = { id: { in: narrowedIds.slice(offset, offset + STUDENT_DIRECTORY_PAGE_SIZE) } };
  }

  const memberships = await prisma.studentMembership.findMany({
    where: pageWhere,
    ...(narrowedIds ? {} : { skip: offset, take: STUDENT_DIRECTORY_PAGE_SIZE }),
    select: {
      id: true,
      studentId: true,
      verifiedSchoolEmail: true,
      expectedGraduationYear: true,
      status: true,
      activatedAt: true,
      student: { select: { firstName: true } },
    },
    orderBy: { activatedAt: "desc" },
  });

  if (memberships.length === 0) return { entries: [], total, page, pageCount };

  const studentIds = memberships.map((m) => m.studentId);

  // One query for the page's students, covering every table a student's
  // answers and sessions can land in. "Last Active Date" still has no
  // dedicated column — it is the most recent of any of them.
  const activity = await getStudentActivity(studentIds);

  return {
    entries: memberships.map((m) => {
      const studentActivity = activity.get(m.studentId) ?? emptyStudentActivity();
      return {
        membershipId: m.id,
        firstName: m.student.firstName,
        schoolEmail: m.verifiedSchoolEmail,
        graduationYear: m.expectedGraduationYear,
        status: m.status,
        registeredAt: m.activatedAt,
        lastActiveAt: studentActivity.lastActiveAt,
        activity: studentActivity,
      };
    }),
    total,
    page,
    pageCount,
  };
}

export type StudentDirectorySummary = {
  /** Every student ever registered here, whatever their status now. */
  registered: number;
  /** Students whose school access is live today. */
  active: number;
  /** Of the active ones: never answered a question. */
  notStarted: number;
  /** Of the active ones: answered something in the last 7 days. */
  activeThisWeek: number;
  /** Of the active ones: started, then nothing for 14 days. */
  goneQuiet: number;
};

/**
 * The line at the top of the Students page (and the Overview's student
 * figures) — how many, and how many need a nudge — counted with
 * `matchesActivity`, the rule the filters use, over ACTIVE students. The
 * cards link to the list filtered the same way (`status=ACTIVE` plus the
 * activity), so a count and the list it opens agree.
 *
 * One query for every student's last answer, where this used to ask "who
 * answered since X" four times with every id inlined, and shared for a
 * minute like the school totals: both admin pages open with it.
 */
export async function computeStudentDirectorySummary(schoolId: string, now: Date = new Date()): Promise<StudentDirectorySummary> {
  const [registered, active, lastAnswered] = await Promise.all([
    prisma.studentMembership.count({ where: { schoolId } }),
    prisma.studentMembership.count({ where: { schoolId, status: "ACTIVE" } }),
    lastAnsweredAtForSchool(schoolId, { activeOnly: true }),
  ]);
  const last = [...lastAnswered.values()];
  const count = (filter: DirectoryActivityFilter) => last.filter((at) => matchesActivity(filter, at, now)).length;
  return {
    registered,
    active,
    // Everyone ACTIVE who has no last answer. Taken as a difference because
    // a student who never answered has no row to count.
    notStarted: Math.max(0, active - last.length),
    activeThisWeek: count("ACTIVE_THIS_WEEK"),
    goneQuiet: count("GONE_QUIET"),
  };
}

/** Five integers, so they survive the shared cache's JSON round trip. */
export const getStudentDirectorySummary = cacheAcrossRequests(
  "student-directory-summary",
  (schoolId: string) => computeStudentDirectorySummary(schoolId),
  60,
);

/**
 * The class years an Administrator may set: from the next class still to
 * graduate through five years after it.
 *
 * The floor is the guard. A student's school access ends on July 1 of their
 * class year, and the graduation sweep then marks them GRADUATED — which no
 * button in the product undoes. In October 2026 a slip of "2026" for "2027"
 * therefore ended a junior's Premium on the spot and, that night, their
 * membership for good. No year inside this window ends anyone's access
 * today. The ceiling only catches a typo like 2207.
 */
export function graduationYearWindow(now: Date = new Date()): { min: number; max: number } {
  const next = graduationCutoffYear(now) + 1;
  return { min: next, max: next + 5 };
}

// PRD-011 §14 — the only two fields an Administrator may correct. Scoped to
// `schoolId` so an admin can never edit a membership at another school, even
// by guessing/replaying a membershipId (server-side authorization, not a
// hidden-UI convention).
export async function updateStudentInfo(
  schoolId: string,
  membershipId: string,
  input: { firstName: string; expectedGraduationYear: number },
  now: Date = new Date(),
): Promise<void> {
  const membership = await prisma.studentMembership.findUnique({ where: { id: membershipId } });
  if (!membership) {
    throw new AdminError("MEMBERSHIP_NOT_FOUND", "Student not found at this school.");
  }
  if (membership.schoolId !== schoolId) {
    // GER §6: an Administrator must never edit a student outside their
    // assigned school — this fires when the membership exists but belongs
    // to a different school, e.g. an id guessed or copied from elsewhere.
    logUnauthorizedAccess("Administrator attempted to edit a student at another school", {
      organizationId: schoolId,
      affectedResourceId: membershipId,
    });
    throw new AdminError("MEMBERSHIP_NOT_FOUND", "Student not found at this school.");
  }
  // A removed or graduated student's record is history: their access has
  // already ended, and moving their class year would only rewrite it.
  if (membership.status !== "ACTIVE") {
    throw new AdminError(
      "INVALID_INPUT",
      "Only students who have access right now can be edited here. To correct an earlier student's record, email PrepHub.",
    );
  }
  // An unchanged year is always allowed, so fixing a first name never trips
  // over a year set before this window existed.
  const { min, max } = graduationYearWindow(now);
  if (
    input.expectedGraduationYear !== membership.expectedGraduationYear &&
    (input.expectedGraduationYear < min || input.expectedGraduationYear > max)
  ) {
    throw new AdminError(
      "INVALID_INPUT",
      input.expectedGraduationYear < min
        ? `Class of ${input.expectedGraduationYear} would end this student's school access right away, and that can't be undone from here. Enter a year from ${min} to ${max}.`
        : `Enter a class year from ${min} to ${max}.`,
    );
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: membership.studentId }, data: { firstName: input.firstName } }),
    prisma.studentMembership.update({
      where: { id: membershipId },
      data: { expectedGraduationYear: input.expectedGraduationYear },
    }),
  ]);
}
