/**
 * When homework stopped being owed on time: its due date, or the moment the
 * teacher closed it if that came first. Null for open homework with no due
 * date, which is never overdue.
 */
export function homeworkDeadline(assignment: { dueAt: Date | null; closedAt: Date | null }): Date | null {
  const { dueAt, closedAt } = assignment;
  if (dueAt && closedAt) return dueAt < closedAt ? dueAt : closedAt;
  return dueAt ?? closedAt;
}

/**
 * Whether a student joined the class after that moment had already passed:
 * homework set before they arrived, which they never had the chance to do on
 * time. Such a student is "Joined later" to their teacher, never "Missing",
 * and is left out of the not-started counts; on their own Homework page it is
 * optional, never a red "was due".
 *
 * The earlier of the two dates, not the close alone, so closing homework
 * afterwards can't turn a student who joined after it was due into one who
 * missed it.
 */
export function joinedAfterDeadline(joinedAt: Date, assignment: { dueAt: Date | null; closedAt: Date | null }): boolean {
  const deadline = homeworkDeadline(assignment);
  return deadline !== null && joinedAt > deadline;
}

/**
 * Turned in after the due date — unless the student joined after the deadline
 * had passed, and so never had an on-time chance to miss. One rule for the
 * teacher's "Late" chip and the student's own "turned in late".
 */
export function turnedInLate(
  completedAt: Date | null,
  assignment: { dueAt: Date | null; closedAt: Date | null },
  joinedAt: Date | null,
): boolean {
  if (!completedAt || !assignment.dueAt || completedAt <= assignment.dueAt) return false;
  return !(joinedAt && joinedAfterDeadline(joinedAt, assignment));
}
