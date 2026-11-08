import { getSchoolAggregateStats } from "@/lib/school/aggregate-stats";
import { getStudentDirectorySummary } from "./student-directory";
import {
  MIN_STUDENTS_FOR_SCORE_FIGURES,
  measureCampusImpact,
  protectedCount,
  type ProtectedCount,
} from "./impact";

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

export type CampusRow = FigureRow & { campusId: string; campusName: string };

export type DistrictOverview = {
  districtName: string;
  totals: FigureRow;
  /** Campuses each district figure leaves out because their own is withheld. */
  excluded: { started: number; activeThisWeek: number; scoreGain: number };
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
export function buildDistrictOverview(districtName: string, raw: RawCampusFigures[]): DistrictOverview {
  const sum = (pick: (r: RawCampusFigures) => number) => raw.reduce((n, r) => n + pick(r), 0);
  const shown = (pick: (r: RawCampusFigures) => number) => raw.filter((r) => protectedCount(pick(r)) !== null);
  const startedShown = shown((r) => r.started);
  const weekShown = shown((r) => r.activeThisWeek);
  const gainShown = raw.filter((r) => r.measurableStudents >= MIN_STUDENTS_FOR_SCORE_FIGURES);
  const total = (rows: RawCampusFigures[], pick: (r: RawCampusFigures) => number) =>
    protectedCount(rows.reduce((n, r) => n + pick(r), 0));
  const gainStudents = gainShown.reduce((n, r) => n + r.measurableStudents, 0);
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
    },
    campuses: raw.map((r) => ({ campusId: r.campusId, campusName: r.campusName, ...toFigureRow(r) })),
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
