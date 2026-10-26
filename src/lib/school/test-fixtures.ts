/**
 * Test support for everything built on `lib/school/student-activity`.
 *
 * Those queries are raw SQL on purpose — the point of them is that a
 * district's answer rows never cross the wire (see the comments there) — which
 * means a test can no longer say "mock `finalizedAttempt.count`". Instead a
 * test describes its fixture as rows, and this derives from it exactly what
 * Postgres would have returned for each of the queries, routing on which table
 * the SQL names. One fixture, one place that knows how the SQL aggregates, so
 * a test still reads as a list of answers and sessions.
 *
 * Shared by the School Community and Admin Overview suites because both go
 * through `getSchoolAggregateStats`. Deliberately imports nothing from vitest
 * — the mock function is taken structurally — so this file can live beside the
 * code it supports without pulling a test framework into any import graph.
 */

/** The one method of a vitest mock this needs, named structurally. */
type MockFn = { mockImplementation: (impl: (...args: never[]) => unknown) => unknown };

export type AnswerRow = { studentId: string; answeredAt: Date };
export type SessionRow = { studentId: string; startedAt: Date; completedAt: Date };
export type PredictionRow = { studentId: string; representativeMidpoint: number; createdAt: Date };

const SESSION_HOUR_CAP = 3;

export type ActivityFixture = {
  answers: AnswerRow[];
  sessions: SessionRow[];
  predictions: PredictionRow[];
};

function cappedHours(session: SessionRow): number {
  const hours = (session.completedAt.getTime() - session.startedAt.getTime()) / 3_600_000;
  return Math.min(Math.max(hours, 0), SESSION_HOUR_CAP);
}

function sinceFrom(values: unknown[]): Date | undefined {
  return values.find((v): v is Date => v instanceof Date);
}

/**
 * Every Date bound anywhere in the query, in order. A condition written as a
 * composed `Prisma.sql` fragment (`answered_at >= ${since}`) arrives as a
 * nested Sql object whose own `values` hold the Date, so a top-level scan
 * alone would never see it.
 */
function datesIn(values: unknown[]): Date[] {
  const found: Date[] = [];
  for (const v of values) {
    if (v instanceof Date) found.push(v);
    else if (v && typeof v === "object" && Array.isArray((v as { values?: unknown[] }).values)) {
      found.push(...datesIn((v as { values: unknown[] }).values));
    }
  }
  return found;
}

function sqlTextOf(call: unknown[]): string {
  return Array.from(call[0] as ArrayLike<string>).join(" ");
}

/**
 * The full text and every bound value of a raw query, fragments included. A
 * composed `Prisma.sql` fragment arrives as a nested object carrying its own
 * `strings` and `values`, so the outer template alone doesn't show what a
 * school-scoped query filters on.
 */
export function flattenSql(call: unknown[]): { text: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  const walk = (strings: ArrayLike<string>, vals: unknown[]) => {
    Array.from(strings).forEach((s, i) => {
      parts.push(s);
      if (i >= vals.length) return;
      const v = vals[i] as { strings?: ArrayLike<string>; values?: unknown[] } | null;
      if (v && typeof v === "object" && v.strings && Array.isArray(v.values)) walk(v.strings, v.values);
      else values.push(v);
    });
  };
  walk(call[0] as ArrayLike<string>, call.slice(1));
  return { text: parts.join(" "), values };
}

/**
 * Installs a `$queryRaw` implementation that answers every student-activity
 * query from `fixture`. Returns the fixture so a test can mutate it in place.
 */
export function installActivityQueryMock(
  queryRaw: MockFn,
  fixture: ActivityFixture,
): ActivityFixture {
  queryRaw.mockImplementation(((...call: unknown[]) => {
    const sql = sqlTextOf(call);
    const values = call.slice(1);

    // Ordered most specific first: the per-student and day queries both wrap
    // the same `answers` CTE, so matching on the CTE alone is not enough.
    if (sql.includes("DATE_TRUNC('day', answered_at)")) {
      const since = sinceFrom(values);
      const days = new Set(
        fixture.answers
          .filter((a) => !since || a.answeredAt >= since)
          .map((a) => new Date(a.answeredAt).toDateString()),
      );
      return Promise.resolve([...days].map((d) => ({ day: new Date(d) })));
    }

    if (sql.includes("SELECT DISTINCT student_id")) {
      const since = sinceFrom(values);
      const students = new Set(
        fixture.answers.filter((a) => !since || a.answeredAt >= since).map((a) => a.studentId),
      );
      return Promise.resolve([...students].map((student_id) => ({ student_id })));
    }

    if (sql.includes("COUNT(DISTINCT student_id)")) {
      const since = sinceFrom(values);
      const students = new Set(
        fixture.answers.filter((a) => !since || a.answeredAt >= since).map((a) => a.studentId),
      );
      return Promise.resolve([{ total: students.size }]);
    }

    if (sql.includes('AS "questionsAnswered"')) {
      return Promise.resolve(perStudentActivity(fixture));
    }

    // After the per-student query, whose text also takes a MAX(answered_at).
    if (sql.includes("MAX(answered_at) AS last_answered_at")) {
      // The fixture has no memberships, so every answer in it is taken to be
      // in the school's scope.
      const latest = new Map<string, Date>();
      for (const a of fixture.answers) {
        const seen = latest.get(a.studentId);
        if (!seen || a.answeredAt > seen) latest.set(a.studentId, a.answeredAt);
      }
      return Promise.resolve(
        [...latest.entries()].map(([student_id, last_answered_at]) => ({ student_id, last_answered_at })),
      );
    }

    if (sql.includes('AS "sessionsCompleted"')) {
      const since = sinceFrom(values) ?? new Date(0);
      const recent = fixture.sessions.filter((s) => s.completedAt >= since);
      return Promise.resolve([
        {
          sessionsCompleted: fixture.sessions.length,
          studyHours: fixture.sessions.reduce((sum, s) => sum + cappedHours(s), 0),
          studentsActiveSince: new Set(recent.map((s) => s.studentId)).size,
          studyHoursSince: recent.reduce((sum, s) => sum + cappedHours(s), 0),
        },
      ]);
    }

    if (sql.includes('AS "hoursBetween"')) {
      const [from, to] = datesIn(values);
      const inWindow = fixture.sessions.filter((s) => s.completedAt >= from && s.completedAt <= to);
      return Promise.resolve([{ hoursBetween: inWindow.reduce((sum, s) => sum + cappedHours(s), 0) }]);
    }

    if (sql.includes("FROM answers")) {
      // since, then an optional until — in that order, as countAnswers binds them.
      const [since, until] = datesIn(values);
      return Promise.resolve([
        {
          total: fixture.answers.filter(
            (a) => (!since || a.answeredAt >= since) && (!until || a.answeredAt <= until),
          ).length,
        },
      ]);
    }

    if (sql.includes("prediction_history_entries")) {
      return Promise.resolve([scoreImprovement(fixture, sinceFrom(values))]);
    }

    throw new Error(`unexpected query: ${sql}`);
  }) as never);

  return fixture;
}

function perStudentActivity(fixture: ActivityFixture) {
  const byStudent = new Map<
    string,
    { questionsAnswered: number; sessionsCompleted: number; studyHours: number; lastActiveAt: Date | null }
  >();
  const touch = (studentId: string) => {
    let row = byStudent.get(studentId);
    if (!row) {
      row = { questionsAnswered: 0, sessionsCompleted: 0, studyHours: 0, lastActiveAt: null };
      byStudent.set(studentId, row);
    }
    return row;
  };
  const latest = (row: { lastActiveAt: Date | null }, at: Date) => {
    if (!row.lastActiveAt || at > row.lastActiveAt) row.lastActiveAt = at;
  };

  for (const answer of fixture.answers) {
    const row = touch(answer.studentId);
    row.questionsAnswered++;
    latest(row, answer.answeredAt);
  }
  for (const session of fixture.sessions) {
    const row = touch(session.studentId);
    row.sessionsCompleted++;
    row.studyHours += cappedHours(session);
    latest(row, session.completedAt);
  }

  return [...byStudent.entries()].map(([studentId, row]) => ({ studentId, ...row }));
}

/** `GREATEST(last - first, 0)` per student, plus the same floor per step. */
function scoreImprovement(fixture: ActivityFixture, since?: Date) {
  const byStudent = new Map<string, PredictionRow[]>();
  for (const entry of fixture.predictions) {
    const list = byStudent.get(entry.studentId);
    if (list) list.push(entry);
    else byStudent.set(entry.studentId, [entry]);
  }

  let total = 0;
  let weekly = 0;
  for (const entries of byStudent.values()) {
    const ordered = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    total += Math.max(
      0,
      ordered[ordered.length - 1].representativeMidpoint - ordered[0].representativeMidpoint,
    );
    for (let i = 1; i < ordered.length; i++) {
      if (!since || ordered[i].createdAt >= since) {
        weekly += Math.max(
          0,
          ordered[i].representativeMidpoint - ordered[i - 1].representativeMidpoint,
        );
      }
    }
  }
  return { total, weekly };
}
