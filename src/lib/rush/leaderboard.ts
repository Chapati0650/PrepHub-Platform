import { prisma } from "@/lib/prisma";
import { cacheAcrossRequests } from "@/lib/shared-cache";

/**
 * The weekly school leaderboard for 1v1 Rush (2026-10-24).
 *
 * **What it ranks: each student's best single rush this week**, not their
 * total points. A total rewards volume, and in Rush volume can be bought with
 * guessing: clicking A–D at random as fast as possible earns roughly 490
 * points in half a minute (a quarter right, each with nearly the full speed
 * bonus), which outpaces honestly working through questions. A best score
 * can't be farmed that way — ten guessed questions almost never beat a real
 * run — and it still gives a student a reason to play again: beating their
 * own mark, or the name above theirs.
 *
 * **Who's on it.** Students with an ACTIVE membership at the school, the same
 * scope as every other school figure. An administrator can view their
 * school's board but never appears on it (they have an assignment, not a
 * membership). Every completed rush counts — solo included — so a student
 * practicing alone can climb it.
 *
 * **Privacy.** First name and class year only, which is less than Rush
 * already shows a matched opponent. A student can hide themselves in
 * Settings (`User.rushLeaderboardHidden`): other students stop seeing them,
 * they still see where they'd stand. The Owner can turn the board off for a
 * school or a whole district (`Organization.rushLeaderboardEnabled`), for
 * any district whose data agreement doesn't allow students to see each
 * other's names and scores. Ranks are computed among visible students only,
 * so a hidden student never leaves a gap that tells others someone is there.
 */

/**
 * The week runs Monday 00:00 to Monday 00:00 in this zone. Central, because
 * the districts this is built for are in Texas; a UTC week would reset on
 * Sunday at 7pm their time, which reads as a bug. Kept as one constant so a
 * per-school zone is a contained change if it's ever needed.
 */
export const LEADERBOARD_TIME_ZONE = "America/Chicago";

/** How many places the board lists. */
export const LEADERBOARD_SIZE = 10;

type ZonedParts = { year: number; month: number; day: number; weekday: number; hour: number; minute: number; second: number };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

/** How far the zone's wall clock is ahead of UTC at this instant, in ms. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant it is midnight on this calendar date in the zone. Checked twice
 * because the offset at a first guess can differ from the offset at the
 * answer when a daylight-saving change falls between them. (Midnight itself
 * always exists in Central time: the clocks change at 2am.)
 */
function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  const first = zoneOffsetMs(new Date(guess), timeZone);
  const second = zoneOffsetMs(new Date(guess - first), timeZone);
  return new Date(guess - second);
}

/**
 * The leaderboard week containing `now`: from the most recent Monday
 * midnight to the next one, in the given zone. Pure, so the boundary cases —
 * Sunday night, Monday just after midnight, a week the clocks change in —
 * are unit-tested rather than discovered on a Monday morning.
 */
export function weekBounds(now: Date, timeZone: string = LEADERBOARD_TIME_ZONE): { start: Date; end: Date } {
  const p = zonedParts(now, timeZone);
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day));
  monday.setUTCDate(monday.getUTCDate() - p.weekday);
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  return {
    start: zonedMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), timeZone),
    end: zonedMidnight(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth() + 1, nextMonday.getUTCDate(), timeZone),
  };
}

export type LeaderboardScope = { schoolId: string; schoolName: string };

/**
 * The school whose board this viewer sees, or null when there isn't one: no
 * school, or a school (or its district) with the board turned off.
 */
export async function leaderboardScopeFor(userId: string): Promise<LeaderboardScope | null> {
  const [membership, assignment] = await Promise.all([
    prisma.studentMembership.findUnique({
      where: { studentId: userId },
      select: {
        status: true,
        school: {
          select: {
            id: true,
            officialName: true,
            rushLeaderboardEnabled: true,
            parentDistrict: { select: { rushLeaderboardEnabled: true } },
          },
        },
      },
    }),
    prisma.administratorAssignment.findFirst({
      where: { userId, removedAt: null, organization: { organizationType: "SCHOOL" } },
      select: {
        organization: {
          select: {
            id: true,
            officialName: true,
            rushLeaderboardEnabled: true,
            parentDistrict: { select: { rushLeaderboardEnabled: true } },
          },
        },
      },
    }),
  ]);

  const school = membership?.status === "ACTIVE" ? membership.school : (assignment?.organization ?? null);
  if (!school) return null;
  if (!school.rushLeaderboardEnabled) return null;
  if (school.parentDistrict && !school.parentDistrict.rushLeaderboardEnabled) return null;
  return { schoolId: school.id, schoolName: school.officialName };
}

export type LeaderboardEntry = {
  rank: number;
  firstName: string;
  classYear: number | null;
  score: number;
  isMe: boolean;
};

export type MyStanding = {
  /** Where they stand among visible students — for a hidden student, where they would. */
  rank: number;
  score: number;
  runs: number;
  hidden: boolean;
};

export type WeeklyLeaderboard = {
  scope: LeaderboardScope;
  weekStart: Date;
  resetsAt: Date;
  entries: LeaderboardEntry[];
  /** Null until the viewer finishes a rush this week. */
  me: MyStanding | null;
  /** Visible students with a rush this week — the "out of" in "#4 of 37". */
  players: number;
  lastWeek: LeaderboardEntry[];
};

type BestRow = {
  studentId: string;
  score: number;
  firstName: string;
  classYear: number | null;
  hidden: boolean;
  runs: number;
};

/**
 * Each student's best completed rush in the window, one row per student,
 * best first. `DISTINCT ON` keeps the best run per student and, on a tie,
 * the earlier one — so the first to reach a score stays above the second.
 */
async function bestRuns(schoolId: string, start: Date, end: Date): Promise<BestRow[]> {
  return prisma.$queryRaw<BestRow[]>`
    WITH school_students AS (
      SELECT m."studentId", m."expectedGraduationYear"
        FROM "student_memberships" m
       WHERE m."schoolId" = ${schoolId}
         AND m."status" = 'ACTIVE'
    ),
    window_runs AS (
      SELECT r."studentId", r."score", r."completedAt"
        FROM "rush_runs" r
        JOIN school_students s ON s."studentId" = r."studentId"
       WHERE r."status" = 'COMPLETED'
         AND r."completedAt" >= ${start}
         AND r."completedAt" < ${end}
    ),
    best AS (
      SELECT DISTINCT ON ("studentId") "studentId", "score", "completedAt"
        FROM window_runs
       ORDER BY "studentId", "score" DESC, "completedAt" ASC
    ),
    played AS (
      SELECT "studentId", COUNT(*)::int AS runs FROM window_runs GROUP BY "studentId"
    )
    SELECT b."studentId",
           b."score",
           u."firstName",
           s."expectedGraduationYear" AS "classYear",
           u."rushLeaderboardHidden" AS hidden,
           p.runs
      FROM best b
      JOIN "users" u ON u."id" = b."studentId"
      JOIN school_students s ON s."studentId" = b."studentId"
      JOIN played p ON p."studentId" = b."studentId"
     WHERE b."score" > 0
     ORDER BY b."score" DESC, b."completedAt" ASC
  `;
}

/**
 * Last week's board can't change any more (a run counts in the week it was
 * finished), so it is shared for an hour rather than recomputed on every
 * visit to the hub. This week's never is: a student who just finished a run
 * is told their new place, and a cached board would contradict them. Hidden
 * students stay in the rows and are filtered per viewer afterwards, exactly
 * as for this week, so a cached copy carries no one viewer's perspective.
 */
const bestRunsLastWeek = cacheAcrossRequests(
  "rush-leaderboard-last-week",
  (schoolId: string, startIso: string, endIso: string) => bestRuns(schoolId, new Date(startIso), new Date(endIso)),
  3600,
);

/**
 * Standard competition ranking among the rows given ("1, 2, 2, 4"): equal
 * scores share a place, and the next place skips. Pure.
 */
export function rankRows<T extends { score: number }>(rows: T[]): (T & { rank: number })[] {
  let rank = 0;
  return rows.map((row, i) => {
    if (i === 0 || Number(rows[i - 1].score) !== Number(row.score)) rank = i + 1;
    return { ...row, rank };
  });
}

export async function getWeeklyLeaderboard(viewerId: string, now: Date = new Date()): Promise<WeeklyLeaderboard | null> {
  const scope = await leaderboardScopeFor(viewerId);
  if (!scope) return null;

  const week = weekBounds(now);
  const previous = weekBounds(new Date(week.start.getTime() - 1));
  const [thisWeek, lastWeekRows] = await Promise.all([
    bestRuns(scope.schoolId, week.start, week.end),
    bestRunsLastWeek(scope.schoolId, previous.start.toISOString(), previous.end.toISOString()),
  ]);

  const toEntry = (r: BestRow & { rank: number }): LeaderboardEntry => ({
    rank: r.rank,
    firstName: r.firstName,
    classYear: r.classYear ?? null,
    score: Number(r.score),
    isMe: r.studentId === viewerId,
  });

  const visible = rankRows(thisWeek.filter((r) => !r.hidden));
  const mine = thisWeek.find((r) => r.studentId === viewerId) ?? null;
  let me: MyStanding | null = null;
  if (mine) {
    // A hidden student isn't in `visible`; their place is where they'd slot in.
    const rank = mine.hidden
      ? visible.filter((r) => Number(r.score) > Number(mine.score)).length + 1
      : visible.find((r) => r.studentId === viewerId)!.rank;
    me = { rank, score: Number(mine.score), runs: Number(mine.runs), hidden: mine.hidden };
  }

  return {
    scope,
    weekStart: week.start,
    resetsAt: week.end,
    entries: visible.slice(0, LEADERBOARD_SIZE).map(toEntry),
    me,
    players: visible.length,
    lastWeek: rankRows(lastWeekRows.filter((r) => !r.hidden))
      .filter((r) => r.rank <= 3)
      .map(toEntry),
  };
}

/** Just the viewer's line, for the results page after a run. */
export async function myWeeklyStanding(
  viewerId: string,
  now: Date = new Date(),
): Promise<{ standing: MyStanding; schoolName: string; players: number } | null> {
  const board = await getWeeklyLeaderboard(viewerId, now);
  if (!board?.me) return null;
  return { standing: board.me, schoolName: board.scope.schoolName, players: board.players };
}
