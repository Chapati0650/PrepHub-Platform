// Pure date-math core, tested independently of the DB query that supplies
// the activity dates. A streak is the number of consecutive calendar days
// (ending today or yesterday — opening the app today without yet studying
// must not break an existing streak) with at least one finalized answer.
export function computeStudyStreak(activityDates: Date[], now: Date): number {
  const dayKeys = new Set(activityDates.map((d) => dayKey(d)));
  let streak = 0;
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  // If today has no activity yet, start checking from yesterday instead —
  // an unstarted today shouldn't itself break a streak still in progress.
  if (!dayKeys.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (dayKeys.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function dayKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
