import { getSchoolAggregateStats } from "@/lib/school/aggregate-stats";
import { getStudentDirectorySummary } from "./student-directory";
import {
  MIN_STUDENTS_FOR_SCORE_FIGURES,
  measureCampusImpact,
  protectedCount,
  protectBenchmarkGroups,
  type CampusImpact,
  type CampusImpactReport,
  type ProtectedCount,
} from "./impact";
import { TSI_MATH_BENCHMARK, TSI_READING_WRITING_BENCHMARK } from "@/lib/score/ccmr";

/**
 * The district administrator's overview (2026-11-08): district totals and one
 * row per campus, built from the same per-campus figures the campus Overview
 * shows. Aggregate-only like everything in the admin area: no row can name a
 * student, a group of 1 to MIN_GROUP_SIZE - 1 is withheld (null) for the
 * campus and for the district alike, and a score figure needs
 * MIN_STUDENTS_FOR_SCORE_FIGURES measurable students before it appears.
 */
export type RawCampusFigures = {
  campusId: string;
  campusName: string;
  registered: number;
  active: number;
  /** Active students who answered at least one question. */
  started: number;
  activeThisWeek: number;
  questionsAnswered: number;
  practiceSetsFinished: number;
  measurableStudents: number;
  /** Sum of every measurable student's score change, so districts can weight by students. */
  totalScoreGain: number;
  /** Raw TSI benchmark groups (see `CampusImpact`); only ever shown through `readinessShown`. */
  benchmark: Omit<CampusImpact["benchmark"], "readingWritingBenchmark" | "mathBenchmark">;
};

export type FigureRow = {
  registered: number;
  active: number;
  started: ProtectedCount;
  activeThisWeek: ProtectedCount;
  questionsAnswered: number;
  practiceSetsFinished: number;
  measurableStudents: number;
  /** Average predicted-score change, or null until enough students can be compared. */
  averageScoreGain: number | null;
};

export type CampusRow = FigureRow & {
  campusId: string;
  campusName: string;
  /**
   * Students whose latest prediction meets both TSI benchmarks, of those measured; null unless the
   * campus's whole readiness breakdown is shown (10+ measured and no group of 1-4), so it can't be
   * combined with the campus page to recover a withheld group.
   */
  readiness: { meet: number; measured: number } | { withheld: true } | null;
};

export type DistrictOverview = {
  districtName: string;
  totals: FigureRow;
  /** Campuses each district figure leaves out because their own is withheld. */
  excluded: { started: number; activeThisWeek: number; scoreGain: number; readiness: number };
  /** The district's TSI breakdown over the campuses whose whole breakdown is shown; null below 10 measured. */
  readiness: CampusImpactReport["benchmark"];
  campuses: CampusRow[];
};

function toFigureRow(
  raw: Pick<
    RawCampusFigures,
    "registered" | "active" | "started" | "activeThisWeek" | "questionsAnswered" | "practiceSetsFinished" | "measurableStudents" | "totalScoreGain"
  >,
): FigureRow {
  return {
    registered: raw.registered,
    active: raw.active,
    started: protectedCount(raw.started),
    activeThisWeek: protectedCount(raw.activeThisWeek),
    questionsAnswered: raw.questionsAnswered,
    practiceSetsFinished: raw.practiceSetsFinished,
    measurableStudents: raw.measurableStudents,
    averageScoreGain:
      raw.measurableStudents >= MIN_STUDENTS_FOR_SCORE_FIGURES
        ? Math.round(raw.totalScoreGain / raw.measurableStudents)
        : null,
  };
}

/**
 * Pure: raw per-campus figures into protected campus rows and a district
 * total. A district figure is computed only from the campuses whose own figure
 * is shown, so a withheld campus value can never be recovered as the district
 * total minus the visible campuses; `excluded` says how many campuses each
 * figure leaves out, for the page to state.
 */
type RawBenchmark = RawCampusFigures["benchmark"];

function measuredOf(b: RawBenchmark): number {
  return b.crossed + b.held + b.slipped + b.below;
}

/** A campus's breakdown is fully shown: enough students measured and no group withheld. */
export function readinessShown(b: RawBenchmark): boolean {
  if (measuredOf(b) < MIN_STUDENTS_FOR_SCORE_FIGURES) return false;
  const groups = [b.crossed, b.held, b.slipped, b.below, b.shortfall.MISSES_MATH_ONLY, b.shortfall.MISSES_READING_ONLY, b.shortfall.MISSES_BOTH];
  return groups.every((n) => protectedCount(n) !== null);
}

function protectBenchmark(b: RawBenchmark): CampusImpactReport["benchmark"] {
  const measured = measuredOf(b);
  if (measured < MIN_STUDENTS_FOR_SCORE_FIGURES) return null;
  return {
    measured,
    ...protectBenchmarkGroups(b),
    readingWritingBenchmark: TSI_READING_WRITING_BENCHMARK,
    mathBenchmark: TSI_MATH_BENCHMARK,
  };
}

export function buildDistrictOverview(districtName: string, raw: RawCampusFigures[]): DistrictOverview {
  const sum = (pick: (r: RawCampusFigures) => number) => raw.reduce((n, r) => n + pick(r), 0);
  const shown = (pick: (r: RawCampusFigures) => number) => raw.filter((r) => protectedCount(pick(r)) !== null);
  const startedShown = shown((r) => r.started);
  const weekShown = shown((r) => r.activeThisWeek);
  const gainShown = raw.filter((r) => r.measurableStudents >= MIN_STUDENTS_FOR_SCORE_FIGURES);
  const total = (rows: RawCampusFigures[], pick: (r: RawCampusFigures) => number) =>
    protectedCount(rows.reduce((n, r) => n + pick(r), 0));
  const gainStudents = gainShown.reduce((n, r) => n + r.measurableStudents, 0);
  // Readiness sums whole campuses only: a campus with any group of 1-4 is left out entirely, so the
  // district figure is a sum of breakdowns that are each shown in full on their campus pages.
  const readyShown = raw.filter((r) => readinessShown(r.benchmark));
  const readyWithData = raw.filter((r) => measuredOf(r.benchmark) > 0);
  const districtBenchmark = readyShown.reduce<RawBenchmark>(
    (acc, r) => ({
      crossed: acc.crossed + r.benchmark.crossed,
      held: acc.held + r.benchmark.held,
      slipped: acc.slipped + r.benchmark.slipped,
      below: acc.below + r.benchmark.below,
      shortfall: {
        MISSES_MATH_ONLY: acc.shortfall.MISSES_MATH_ONLY + r.benchmark.shortfall.MISSES_MATH_ONLY,
        MISSES_READING_ONLY: acc.shortfall.MISSES_READING_ONLY + r.benchmark.shortfall.MISSES_READING_ONLY,
        MISSES_BOTH: acc.shortfall.MISSES_BOTH + r.benchmark.shortfall.MISSES_BOTH,
      },
    }),
    { crossed: 0, held: 0, slipped: 0, below: 0, shortfall: { MISSES_MATH_ONLY: 0, MISSES_READING_ONLY: 0, MISSES_BOTH: 0 } },
  );
  return {
    districtName,
    totals: {
      registered: sum((r) => r.registered),
      active: sum((r) => r.active),
      started: total(startedShown, (r) => r.started),
      activeThisWeek: total(weekShown, (r) => r.activeThisWeek),
      questionsAnswered: sum((r) => r.questionsAnswered),
      practiceSetsFinished: sum((r) => r.practiceSetsFinished),
      measurableStudents: gainStudents,
      averageScoreGain:
        gainStudents > 0 ? Math.round(gainShown.reduce((n, r) => n + r.totalScoreGain, 0) / gainStudents) : null,
    },
    excluded: {
      started: raw.length - startedShown.length,
      activeThisWeek: raw.length - weekShown.length,
      scoreGain: raw.length - gainShown.length,
      readiness: readyWithData.filter((r) => !readinessShown(r.benchmark)).length,
    },
    readiness: protectBenchmark(districtBenchmark),
    campuses: raw.map((r) => ({
      campusId: r.campusId,
      campusName: r.campusName,
      ...toFigureRow(r),
      readiness: readinessShown(r.benchmark)
        ? { meet: r.benchmark.crossed + r.benchmark.held, measured: measuredOf(r.benchmark) }
        : measuredOf(r.benchmark) >= MIN_STUDENTS_FOR_SCORE_FIGURES
          ? { withheld: true as const }
          : null,
    })),
  };
}

async function rawFiguresForCampus(campus: { id: string; name: string }): Promise<RawCampusFigures> {
  const [students, agg, impact] = await Promise.all([
    getStudentDirectorySummary(campus.id),
    getSchoolAggregateStats(campus.id),
    measureCampusImpact(campus.id),
  ]);
  return {
    campusId: campus.id,
    campusName: campus.name,
    registered: students.registered,
    active: students.active,
    started: Math.max(0, students.active - students.notStarted),
    activeThisWeek: students.activeThisWeek,
    questionsAnswered: agg.stats.totalQuestionsAnswered,
    practiceSetsFinished: agg.stats.totalAdaptiveSessionsCompleted,
    measurableStudents: impact.measurableStudents,
    totalScoreGain: impact.averageScoreGain === null ? 0 : impact.averageScoreGain * impact.measurableStudents,
    benchmark: {
      crossed: impact.benchmark.crossed,
      held: impact.benchmark.held,
      slipped: impact.benchmark.slipped,
      below: impact.benchmark.below,
      shortfall: impact.benchmark.shortfall,
    },
  };
}

/**
 * `campuses` must be the administrator's own district's campuses (from
 * `requireAdminSchoolContext`), never an id taken from a request.
 */
export async function getDistrictOverview(
  districtName: string,
  campuses: { id: string; name: string }[],
): Promise<DistrictOverview> {
  return buildDistrictOverview(districtName, await Promise.all(campuses.map(rawFiguresForCampus)));
}
