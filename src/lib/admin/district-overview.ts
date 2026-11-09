import { getSchoolAggregateStats } from "@/lib/school/aggregate-stats";
import { getStudentDirectorySummary } from "./student-directory";
import {
  MIN_STUDENTS_FOR_SCORE_FIGURES,
  measureCampusImpact,
  protectedCount,
  protectBenchmarkGroups,
  benchmarkCells,
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
  /** `meet` null: a group of 1-4 ("Fewer than 5"). */
  readiness: { meet: number | null; measured: number } | { withheld: true } | null;
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
    // Activity counts, not performance: the campus page and its Students list show them exactly, so
    // "Fewer than 5" here hid nothing (review, 2026-11-09).
    started: raw.started,
    activeThisWeek: raw.activeThisWeek,
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

/**
 * How many meet both benchmarks now, when the campus page already gives it away (measured minus
 * "Still below" minus "Fell back", both shown), else null. Showing it then adds nothing; showing it
 * otherwise could (review, 2026-11-09: "Withheld" here protected nothing, the campus page had it).
 */
export function campusMeetNow(b: RawBenchmark): { meet: number | null; measured: number } | { withheld: true } | null {
  const measured = measuredOf(b);
  if (measured < MIN_STUDENTS_FOR_SCORE_FIGURES) return null;
  const { meetNow } = protectBenchmarkGroups(b);
  return meetNow === "withheld" ? { withheld: true } : { meet: meetNow, measured };
}

const GROUP_KEYS = ["crossed", "held", "slipped", "below"] as const;
const SHORT_KEYS = ["MISSES_MATH_ONLY", "MISSES_READING_ONLY", "MISSES_BOTH"] as const;

/**
 * The district's TSI breakdown over every campus with enough students measured (2026-11-09; it used to
 * take only campuses with no small group, which in practice was one). A district group is the sum of
 * the campuses'. Where exactly one campus hides that group on its own page, the district figure would
 * give it away (district minus the others), so it is withheld; where two or more do, it reveals only
 * their sum. Then the district's own breakdown gets the same one-more-group rule a campus's does.
 */
export function districtBenchmark(campuses: RawBenchmark[]): CampusImpactReport["benchmark"] {
  const included = campuses.filter((b) => measuredOf(b) >= MIN_STUDENTS_FOR_SCORE_FIGURES);
  const shown = included.map((b) => protectBenchmarkGroups(b));
  const total: RawBenchmark = {
    crossed: 0,
    held: 0,
    slipped: 0,
    below: 0,
    shortfall: { MISSES_MATH_ONLY: 0, MISSES_READING_ONLY: 0, MISSES_BOTH: 0 },
  };
  for (const b of included) {
    for (const k of GROUP_KEYS) total[k] += b[k];
    for (const k of SHORT_KEYS) total.shortfall[k] += b.shortfall[k];
  }
  const measured = measuredOf(total);
  if (measured < MIN_STUDENTS_FOR_SCORE_FIGURES) return null;
  const cell = (sum: number, hiddenAtCampuses: number) => (hiddenAtCampuses === 1 ? ("withheld" as const) : protectedCount(sum));
  const groups = GROUP_KEYS.map((k) => cell(total[k], shown.filter((p) => typeof p[k] !== "number").length));
  const shortfall = SHORT_KEYS.map((k) => cell(total.shortfall[k], shown.filter((p) => typeof p.shortfall[k] !== "number").length));
  return {
    measured,
    ...benchmarkCells(total, { groups, shortfall }),
    readingWritingBenchmark: TSI_READING_WRITING_BENCHMARK,
    mathBenchmark: TSI_MATH_BENCHMARK,
  };
}

export function buildDistrictOverview(districtName: string, raw: RawCampusFigures[]): DistrictOverview {
  const sum = (pick: (r: RawCampusFigures) => number) => raw.reduce((n, r) => n + pick(r), 0);
  const gainShown = raw.filter((r) => r.measurableStudents >= MIN_STUDENTS_FOR_SCORE_FIGURES);
  const gainStudents = gainShown.reduce((n, r) => n + r.measurableStudents, 0);
  return {
    districtName,
    totals: {
      registered: sum((r) => r.registered),
      active: sum((r) => r.active),
      started: sum((r) => r.started),
      activeThisWeek: sum((r) => r.activeThisWeek),
      questionsAnswered: sum((r) => r.questionsAnswered),
      practiceSetsFinished: sum((r) => r.practiceSetsFinished),
      measurableStudents: gainStudents,
      averageScoreGain:
        gainStudents > 0 ? Math.round(gainShown.reduce((n, r) => n + r.totalScoreGain, 0) / gainStudents) : null,
    },
    excluded: {
      started: 0,
      activeThisWeek: 0,
      scoreGain: raw.length - gainShown.length,
      // Campuses with someone measured but fewer than the minimum: not in the district figure.
      readiness: raw.filter((r) => measuredOf(r.benchmark) > 0 && measuredOf(r.benchmark) < MIN_STUDENTS_FOR_SCORE_FIGURES).length,
    },
    readiness: districtBenchmark(raw.map((r) => r.benchmark)),
    campuses: raw.map((r) => ({
      campusId: r.campusId,
      campusName: r.campusName,
      ...toFigureRow(r),
      readiness: campusMeetNow(r.benchmark),
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
