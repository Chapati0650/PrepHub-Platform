import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { cappedHours, inSchools, schoolsSessionActivity } from "@/lib/school/student-activity";
import { MIN_STUDENTS_FOR_SCORE_FIGURES } from "./impact";

/**
 * Score growth by hours of practice (2026-11-09), for the campus and district
 * Overviews: Houston ISD's CCMR office asked for expected score growth by time
 * studied, the way Khan Academy reports "+100 points for 20 hours" to them.
 *
 * Each measurable student (a first and a latest prediction from the same
 * engine, exactly as the "Average gain" figure counts them) is placed in a
 * band by their total practice hours (every kind of finished session, each
 * capped, the same definition as the Overview's study hours), and each band
 * shows how many students it holds and their average predicted-score change.
 *
 * Privacy is structural, as in `impact.ts`:
 *  - The query returns one row per band (a count and a sum), never a student.
 *  - `mergeBands` folds any band under MIN_STUDENTS_FOR_SCORE_FIGURES into its
 *    neighbour until every band shown is at least that size. Nothing is
 *    withheld, so no small group can be recovered as "the total minus the
 *    bands shown": every measurable student is in a shown band.
 *  - A district figure is computed over the campuses whose own score figure is
 *    shown (the caller passes those), for the same reason the district's
 *    average gain is.
 *
 * It is an association, not a measured effect of practice: students who
 * practice more may differ in other ways. The page says so.
 */

/** Lower edges of the bands, in hours; the last band is open-ended. */
export const STUDY_TIME_EDGES = [0, 1, 2, 4, 7, 12, 20] as const;

export type RawBand = { band: number; students: number; totalGain: number };

export type GrowthBand = {
  fromHours: number;
  /** Null for the open-ended top band. */
  toHours: number | null;
  students: number;
  averageGain: number;
};

export type GrowthByStudyTime = {
  bands: GrowthBand[];
  /** Every measurable student, all of them in a band above. */
  measured: number;
};

/**
 * Pure: per-band counts and sums into bands of at least `min` students each,
 * merging a small band into the one above it (the top band into the one
 * below). Null when fewer than two bands survive: one band is just the
 * overall average, already shown beside it.
 */
export function mergeBands(
  raw: RawBand[],
  edges: readonly number[] = STUDY_TIME_EDGES,
  min: number = MIN_STUDENTS_FOR_SCORE_FIGURES,
): GrowthByStudyTime | null {
  type Acc = { from: number; to: number | null; students: number; totalGain: number };
  const byBand = new Map(raw.map((r) => [r.band, r]));
  let bands: Acc[] = edges.map((from, i) => ({
    from,
    to: i + 1 < edges.length ? edges[i + 1] : null,
    students: byBand.get(i)?.students ?? 0,
    totalGain: byBand.get(i)?.totalGain ?? 0,
  }));
  const measured = bands.reduce((n, b) => n + b.students, 0);
  if (measured < 2 * min) return null;

  // Fold upward: a small band joins the next one.
  const folded: Acc[] = [];
  let carry: Acc | null = null;
  for (const b of bands) {
    const cur: Acc = carry ? { from: carry.from, to: b.to, students: carry.students + b.students, totalGain: carry.totalGain + b.totalGain } : b;
    if (cur.students < min) carry = cur;
    else {
      folded.push(cur);
      carry = null;
    }
  }
  // A small remainder at the top joins the band below it.
  if (carry) {
    const last = folded.pop();
    if (!last) return null;
    folded.push({ from: last.from, to: null, students: last.students + carry.students, totalGain: last.totalGain + carry.totalGain });
  }
  bands = folded;
  if (bands.length < 2) return null;
  return {
    measured,
    bands: bands.map((b) => ({ fromHours: b.from, toHours: b.to, students: b.students, averageGain: Math.round(b.totalGain / b.students) })),
  };
}

/** "Under 1 hour", "2–4 hours", "20+ hours". */
export function bandLabel(band: Pick<GrowthBand, "fromHours" | "toHours">): string {
  if (band.fromHours === 0 && band.toHours !== null) return `Under ${band.toHours} ${band.toHours === 1 ? "hour" : "hours"}`;
  if (band.toHours === null) return `${band.fromHours}+ hours`;
  return `${band.fromHours}–${band.toHours} hours`;
}

/**
 * The bands for these campuses' ACTIVE students. `schoolIds` must come from
 * the administrator's own context (their school, or their district's campuses
 * whose score figure is shown), never from a request.
 */
export async function getGrowthByStudyTime(schoolIds: string[]): Promise<GrowthByStudyTime | null> {
  if (schoolIds.length === 0) return null;
  const edges = STUDY_TIME_EDGES;
  const bandCase = Prisma.sql`CASE ${Prisma.join(
    edges.slice(1).map((edge, i) => Prisma.sql`WHEN COALESCE(h.hours, 0) < ${edge} THEN ${i}`),
    " ",
  )} ELSE ${edges.length - 1} END`;
  const rows = await prisma.$queryRaw<{ band: number; students: number; totalGain: number }[]>`
    WITH sessions AS (${schoolsSessionActivity(schoolIds)}),
         hours AS (
           SELECT student_id, SUM(${cappedHours("started_at", "completed_at")}) AS hours
             FROM sessions
            GROUP BY student_id
         ),
         scoped AS (
           SELECT p."studentId", p."id", p."createdAt", p."representativeMidpoint", p."scoringEngineVersion",
                  FIRST_VALUE(p."scoringEngineVersion") OVER (
                    PARTITION BY p."studentId" ORDER BY p."createdAt" DESC, p."id" DESC
                  ) AS latest_version
             FROM "prediction_history_entries" p
            WHERE ${inSchools('p."studentId"', schoolIds)}
         ),
         comparable AS (
           SELECT s.*,
                  ROW_NUMBER() OVER (PARTITION BY s."studentId" ORDER BY s."createdAt" ASC, s."id" ASC) AS rn_first,
                  ROW_NUMBER() OVER (PARTITION BY s."studentId" ORDER BY s."createdAt" DESC, s."id" DESC) AS rn_last,
                  COUNT(*) OVER (PARTITION BY s."studentId") AS entry_count
             FROM scoped s
            WHERE s."scoringEngineVersion" = s.latest_version
         ),
         ends AS (
           SELECT f."studentId", (l."representativeMidpoint" - f."representativeMidpoint") AS gain
             FROM comparable f
             JOIN comparable l ON l."studentId" = f."studentId" AND l.rn_last = 1
            WHERE f.rn_first = 1 AND f.entry_count > 1
         )
    SELECT ${bandCase}::int              AS band,
           COUNT(*)::int                 AS students,
           SUM(e.gain)::double precision AS "totalGain"
      FROM ends e
      LEFT JOIN hours h ON h.student_id = e."studentId"
     GROUP BY 1
     ORDER BY 1
  `;
  return mergeBands(rows.map((r) => ({ band: Number(r.band), students: Number(r.students), totalGain: Number(r.totalGain) })), edges);
}
