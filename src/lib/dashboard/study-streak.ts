// Pure day-counting core of every streak in the product, tested apart from
// the queries that supply the days. A streak is the number of consecutive
// calendar days, ending today or yesterday, that appear in `days` — opening
// the app today without having studied yet must not break a streak still in
// progress, so an unstudied today starts the count from yesterday instead.
//
// Days are `YYYY-MM-DD` keys already in whichever zone the caller counts in:
// Central for a student's study streak (`dashboard-data.ts`), UTC for the
// Daily Challenge, whose question changes at UTC midnight. Stepping from one
// key to the day before is plain calendar arithmetic, so no zone is involved
// here at all — which is what the old `setHours(0, 0, 0, 0)` version got
// wrong: it counted in the server's zone, and the server runs in UTC, so a
// Texas student's day ended at 7pm.
export function streakFromDays(days: ReadonlySet<string>, today: string): number {
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!days.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(utcDay(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

// For the school-wide streak (`lib/school/aggregate-stats`), whose days come
// from `answerDays` as one midnight-UTC timestamp per UTC day, so they are
// keyed in UTC to match. A student's own streak doesn't come through here: it
// asks the database for Central day keys and calls `streakFromDays` directly.
export function computeStudyStreak(activityDates: Date[], now: Date): number {
  return streakFromDays(new Set(activityDates.map(utcDay)), utcDay(now));
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
