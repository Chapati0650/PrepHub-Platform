// Reordering for modules and lessons, as pure list operations. The DB stores
// a `position` per row; these produce the full new position map so the
// caller can write every row in one transaction and there is never a gap or
// a duplicate — a state the syllabus would otherwise render in the wrong
// order for every student.

export type Positioned = { id: string; position: number };

// Positions as 0..n-1 in the order given, regardless of what they were.
export function renumber<T extends Positioned>(items: readonly T[]): { id: string; position: number }[] {
  return items.map((item, i) => ({ id: item.id, position: i }));
}

// Moves `id` one step in `direction` and returns the renumbered list. A move
// that can't happen (already first / already last / unknown id) returns the
// list renumbered as-is, so a double-click on "move up" at the top is a
// no-op rather than an error.
export function moveItem<T extends Positioned>(
  items: readonly T[],
  id: string,
  direction: "up" | "down",
): { id: string; position: number }[] {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const index = sorted.findIndex((item) => item.id === id);
  if (index === -1) return renumber(sorted);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= sorted.length) return renumber(sorted);
  [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
  return renumber(sorted);
}

// The position a newly created item takes: after everything that exists.
export function nextPosition(items: readonly Positioned[]): number {
  return items.reduce((max, item) => Math.max(max, item.position + 1), 0);
}
