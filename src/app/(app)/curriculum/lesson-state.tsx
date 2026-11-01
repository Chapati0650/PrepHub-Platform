// A lesson's state, for screen readers. The syllabus marks it with icons
// (a check, a lock) that are aria-hidden, which left "completed" and "needs
// Premium" conveyed by the picture alone. Used by the course page and the
// lesson page's syllabus rail, so the two say it the same way.
export function LessonState({ completed, locked }: { completed: boolean; locked: boolean }) {
  if (completed) return <span className="sr-only"> (Completed)</span>;
  if (locked) return <span className="sr-only"> (Premium)</span>;
  return null;
}
