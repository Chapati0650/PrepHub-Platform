import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * One definition of "this student answered a question" and "this student
 * finished a session", shared by every school-facing surface.
 *
 * Why this module exists: answering is recorded in seven different tables,
 * because each study mode that was added after the adaptive core deliberately
 * kept its own rows rather than writing into `FinalizedAttempt` (see
 * CLAUDE.md on the 800 Club, 1v1 Rush, Focused Practice and the Daily
 * Challenge — the isolation is what keeps a hard-only or speed-only sample out
 * of the adaptive engine). The cost of that isolation is that anything
 * counting "questions answered" has to know all of them, and the school
 * aggregate knew only two. A student who had answered two hundred Focused
 * Practice questions showed on a campus report as having answered none of
 * them, which for a district paying per student is simply a wrong number.
 * Homework (2026-10-24) was the seventh, added here and nowhere else.
 *
 * Both fragments below are composed into whichever query needs them, so a
 * new study mode is added in exactly one place and every campus figure picks
 * it up at once.
 */

/**
 * (student_id, answered_at) — one row per question a student has answered,
 * anywhere in the product.
 *
 * Every mode's "answered" marker differs, and each one is the column its own
 * finalization writes: `finalizedAt` for adaptive/focused/club/homework slots,
 * `submittedAt` for a diagnostic attempt, `answeredAt` for Rush and the Daily
 * Challenge. A null marker means the question was served but never answered,
 * so each branch excludes it.
 */
function answerActivity(studentIds: string[]): Prisma.Sql {
  const ids = Prisma.join(studentIds);
  return Prisma.sql`
    SELECT fa."studentId" AS student_id, fa."finalizedAt" AS answered_at
      FROM "finalized_attempts" fa
     WHERE fa."studentId" IN (${ids})
    UNION ALL
    SELECT ds."studentId", da."submittedAt"
      FROM "diagnostic_attempts" da
      JOIN "diagnostic_sessions" ds ON ds."id" = da."diagnosticSessionId"
     WHERE ds."studentId" IN (${ids})
       AND da."submittedAt" IS NOT NULL
    UNION ALL
    SELECT fs."studentId", fsl."finalizedAt"
      FROM "focused_slots" fsl
      JOIN "focused_sessions" fs ON fs."id" = fsl."sessionId"
     WHERE fs."studentId" IN (${ids})
       AND fsl."finalizedAt" IS NOT NULL
    UNION ALL
    SELECT cs."studentId", csl."finalizedAt"
      FROM "club_slots" csl
      JOIN "club_sessions" cs ON cs."id" = csl."sessionId"
     WHERE cs."studentId" IN (${ids})
       AND csl."finalizedAt" IS NOT NULL
    UNION ALL
    SELECT rr."studentId", ra."answeredAt"
      FROM "rush_answers" ra
      JOIN "rush_runs" rr ON rr."id" = ra."runId"
     WHERE rr."studentId" IN (${ids})
       AND ra."answeredAt" IS NOT NULL
    UNION ALL
    SELECT dca."studentId", dca."answeredAt"
      FROM "daily_challenge_attempts" dca
     WHERE dca."studentId" IN (${ids})
    UNION ALL
    SELECT hs."studentId", hsl."finalizedAt"
      FROM "homework_slots" hsl
      JOIN "homework_sessions" hs ON hs."id" = hsl."sessionId"
     WHERE hs."studentId" IN (${ids})
       AND hsl."finalizedAt" IS NOT NULL
  `;
}

/**
 * (student_id, started_at, completed_at) — one row per *finished* study
 * session of any kind.
 *
 * `PracticeSet` and the two later session tables record their start as
 * `createdAt`; `DiagnosticSession` and `RushRun` use `startedAt`. That
 * asymmetry is the reason this is written out per table rather than generated.
 */
function sessionActivity(studentIds: string[]): Prisma.Sql {
  const ids = Prisma.join(studentIds);
  return Prisma.sql`
    SELECT ps."studentId" AS student_id, ps."createdAt" AS started_at, ps."completedAt" AS completed_at
      FROM "practice_sets" ps
     WHERE ps."studentId" IN (${ids}) AND ps."completedAt" IS NOT NULL
    UNION ALL
    SELECT d."studentId", d."startedAt", d."completedAt"
      FROM "diagnostic_sessions" d
     WHERE d."studentId" IN (${ids}) AND d."completedAt" IS NOT NULL
    UNION ALL
    SELECT fs."studentId", fs."createdAt", fs."completedAt"
      FROM "focused_sessions" fs
     WHERE fs."studentId" IN (${ids}) AND fs."completedAt" IS NOT NULL
    UNION ALL
    SELECT cs."studentId", cs."createdAt", cs."completedAt"
      FROM "club_sessions" cs
     WHERE cs."studentId" IN (${ids}) AND cs."completedAt" IS NOT NULL
    UNION ALL
    SELECT rr."studentId", rr."startedAt", rr."completedAt"
      FROM "rush_runs" rr
     WHERE rr."studentId" IN (${ids}) AND rr."completedAt" IS NOT NULL
    UNION ALL
    SELECT hs."studentId", hs."createdAt", hs."completedAt"
      FROM "homework_sessions" hs
     WHERE hs."studentId" IN (${ids}) AND hs."completedAt" IS NOT NULL
  `;
}

/**
 * A session left open overnight would otherwise report as a 14-hour sitting.
 * Capped rather than discarded, so a long-but-real session still counts for
 * something. The same cap `getCampusImpact` applies, for the same reason.
 */
const SESSION_HOUR_CAP = 3;

function cappedHours(startExpr: string, endExpr: string): Prisma.Sql {
  return Prisma.sql`LEAST(GREATEST(EXTRACT(EPOCH FROM (${Prisma.raw(endExpr)} - ${Prisma.raw(startExpr)})) / 3600.0, 0), ${SESSION_HOUR_CAP})`;
}

/**
 * What one student has done, as an Administrator is allowed to see it.
 *
 * Activity, never performance: how much work, when it last happened, and
 * nothing about whether the answers were right. PRD-011 §7's line is drawn at
 * individual *performance*, and an administrator asking "has this student
 * actually started?" needs none of it. There is no correctness, ability,
 * mastery or predicted-score field here and none should be added — that is a
 * separate decision, not an extension of this one.
 */
export type StudentActivity = {
  questionsAnswered: number;
  sessionsCompleted: number;
  studyHours: number;
  lastActiveAt: Date | null;
};

const NO_ACTIVITY: StudentActivity = {
  questionsAnswered: 0,
  sessionsCompleted: 0,
  studyHours: 0,
  lastActiveAt: null,
};

export function emptyStudentActivity(): StudentActivity {
  return { ...NO_ACTIVITY };
}

/**
 * Per-student activity for a bounded set of students — one row each, one round
 * trip, every count done in the database.
 *
 * Callers must pass a page's worth of ids, not a whole district's: this is
 * `IN (...)` over the ids given, so the caller's paging is what bounds it.
 */
export async function getStudentActivity(studentIds: string[]): Promise<Map<string, StudentActivity>> {
  const activity = new Map<string, StudentActivity>();
  if (studentIds.length === 0) return activity;

  const rows = await prisma.$queryRaw<
    {
      studentId: string;
      questionsAnswered: number;
      sessionsCompleted: number;
      studyHours: number | null;
      lastActiveAt: Date | null;
    }[]
  >`
    WITH answers AS (${answerActivity(studentIds)}),
         sessions AS (${sessionActivity(studentIds)}),
         per_student AS (
           SELECT student_id, COUNT(*)::int AS answered, MAX(answered_at) AS last_answered_at, 0 AS finished, 0::numeric AS hours
             FROM answers
            GROUP BY student_id
           UNION ALL
           SELECT student_id, 0, MAX(completed_at), COUNT(*)::int,
                  SUM(${cappedHours("started_at", "completed_at")})
             FROM sessions
            GROUP BY student_id
         )
    SELECT student_id                              AS "studentId",
           SUM(answered)::int                      AS "questionsAnswered",
           SUM(finished)::int                      AS "sessionsCompleted",
           SUM(hours)::double precision            AS "studyHours",
           MAX(last_answered_at)                   AS "lastActiveAt"
      FROM per_student
     GROUP BY student_id
  `;

  for (const row of rows) {
    activity.set(row.studentId, {
      questionsAnswered: Number(row.questionsAnswered ?? 0),
      sessionsCompleted: Number(row.sessionsCompleted ?? 0),
      studyHours: row.studyHours === null ? 0 : Number(row.studyHours),
      lastActiveAt: row.lastActiveAt,
    });
  }
  return activity;
}

/**
 * How many questions these students have answered in total, optionally only
 * since a moment (and, for a goal with a deadline, until one). One integer,
 * counted in the database.
 */
export async function countAnswers(studentIds: string[], since?: Date, until?: Date): Promise<number> {
  if (studentIds.length === 0) return 0;
  const rows = await prisma.$queryRaw<{ total: number }[]>`
    WITH answers AS (${answerActivity(studentIds)})
    SELECT COUNT(*)::int AS total
      FROM answers
     WHERE ${since ? Prisma.sql`answered_at >= ${since}` : Prisma.sql`TRUE`}
       AND ${until ? Prisma.sql`answered_at <= ${until}` : Prisma.sql`TRUE`}
  `;
  return Number(rows[0]?.total ?? 0);
}

/**
 * Capped study hours from sessions these students finished between two
 * moments — a community goal's window. One number, aggregated in the database.
 */
export async function studyHoursBetween(studentIds: string[], from: Date, to: Date): Promise<number> {
  if (studentIds.length === 0) return 0;
  const rows = await prisma.$queryRaw<{ hoursBetween: number | null }[]>`
    WITH sessions AS (${sessionActivity(studentIds)})
    SELECT SUM(${cappedHours("started_at", "completed_at")})::double precision AS "hoursBetween"
      FROM sessions
     WHERE completed_at >= ${from} AND completed_at <= ${to}
  `;
  return Number(rows[0]?.hoursBetween ?? 0);
}

/**
 * How many of these students answered anything since a moment. One integer.
 */
export async function countActiveStudents(studentIds: string[], since: Date): Promise<number> {
  if (studentIds.length === 0) return 0;
  const rows = await prisma.$queryRaw<{ total: number }[]>`
    WITH answers AS (${answerActivity(studentIds)})
    SELECT COUNT(DISTINCT student_id)::int AS total
      FROM answers
     WHERE answered_at >= ${since}
  `;
  return Number(rows[0]?.total ?? 0);
}

/**
 * One Date per calendar day on which any of these students answered anything.
 *
 * At most one row per day regardless of district size, where the equivalent
 * `findMany` would have been one row per answer. A study streak only cares
 * which days appear, so a single timestamp per day is enough.
 */
export async function answerDays(studentIds: string[], since: Date): Promise<Date[]> {
  if (studentIds.length === 0) return [];
  const rows = await prisma.$queryRaw<{ day: Date }[]>`
    WITH answers AS (${answerActivity(studentIds)})
    SELECT DISTINCT DATE_TRUNC('day', answered_at) AS day
      FROM answers
     WHERE answered_at >= ${since}
  `;
  return rows.map((r) => r.day);
}

/**
 * Completed sessions and capped study hours for these students, as totals and
 * since a moment. Returns four integers, aggregated in the database.
 */
export async function getSessionTotals(
  studentIds: string[],
  since: Date,
): Promise<{
  sessionsCompleted: number;
  studyHours: number;
  studentsActiveSince: number;
  studyHoursSince: number;
}> {
  if (studentIds.length === 0) {
    return { sessionsCompleted: 0, studyHours: 0, studentsActiveSince: 0, studyHoursSince: 0 };
  }
  const rows = await prisma.$queryRaw<
    {
      sessionsCompleted: number;
      studyHours: number | null;
      studentsActiveSince: number;
      studyHoursSince: number | null;
    }[]
  >`
    WITH sessions AS (${sessionActivity(studentIds)})
    SELECT COUNT(*)::int AS "sessionsCompleted",
           SUM(${cappedHours("started_at", "completed_at")})::double precision AS "studyHours",
           COUNT(DISTINCT CASE WHEN completed_at >= ${since} THEN student_id END)::int AS "studentsActiveSince",
           SUM(CASE WHEN completed_at >= ${since} THEN ${cappedHours("started_at", "completed_at")} ELSE 0 END)::double precision AS "studyHoursSince"
      FROM sessions
  `;
  const row = rows[0];
  return {
    sessionsCompleted: Number(row?.sessionsCompleted ?? 0),
    studyHours: Number(row?.studyHours ?? 0),
    studentsActiveSince: Number(row?.studentsActiveSince ?? 0),
    studyHoursSince: Number(row?.studyHoursSince ?? 0),
  };
}
