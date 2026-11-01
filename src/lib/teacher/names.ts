import { LAST_NAME_MAX, TEACHER_DISPLAY_NAME_MAX } from "./config";
import { TeacherError } from "./errors";

/**
 * How people are named across classes and homework. Pure, so the gradebook,
 * the results page, the export and the emails all name a student or a
 * teacher the same way.
 *
 * A PrepHub account holds a first name only (PRD-001). A class needs more:
 * two students called Mason are one name in a gradebook. So a student gives
 * their last name to a class when they join it, and it lives on that
 * enrollment, seen by that class's teacher and nobody else.
 */

// Letters (any script), then letters, spaces, hyphens, apostrophes and
// periods: "O'Brien", "García-López", "St. John". No digits or "@", so an
// email address can't be typed into the field by mistake.
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}' .’-]*$/u;

function tidy(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function cleanLastName(raw: string): string {
  const name = tidy(raw);
  if (!name) throw new TeacherError("INVALID_INPUT", "Enter your last name, so your teacher knows it's you.");
  if (name.length > LAST_NAME_MAX) throw new TeacherError("INVALID_INPUT", `Keep it under ${LAST_NAME_MAX} characters.`);
  if (!NAME_PATTERN.test(name)) throw new TeacherError("INVALID_INPUT", "Enter just your last name, using letters.");
  return name;
}

export function cleanTeacherDisplayName(raw: string): string {
  const name = tidy(raw);
  if (!name) throw new TeacherError("INVALID_INPUT", "Enter the name your students call you, like “Ms. Alvarez”.");
  if (name.length > TEACHER_DISPLAY_NAME_MAX) {
    throw new TeacherError("INVALID_INPUT", `Keep it under ${TEACHER_DISPLAY_NAME_MAX} characters.`);
  }
  return name;
}

/** "Alvarez, Maria", or just "Maria" for a student who hasn't given a last name. */
export function studentRosterName(s: { firstName: string; lastName: string | null }): string {
  return s.lastName ? `${s.lastName}, ${s.firstName}` : s.firstName;
}

/** "Maria Alvarez", for a sentence ("Remove Maria Alvarez from this class?"). */
export function studentFullName(s: { firstName: string; lastName: string | null }): string {
  return s.lastName ? `${s.firstName} ${s.lastName}` : s.firstName;
}

/**
 * Alphabetical by last name, the order of every school roster. A student who
 * hasn't given one sorts by first name among them, after everyone who has,
 * so a teacher can see who still needs to.
 */
export function compareRosterNames(
  a: { firstName: string; lastName: string | null },
  b: { firstName: string; lastName: string | null },
): number {
  if (Boolean(a.lastName) !== Boolean(b.lastName)) return a.lastName ? -1 : 1;
  const byLast = (a.lastName ?? "").localeCompare(b.lastName ?? "", "en", { sensitivity: "base" });
  return byLast || a.firstName.localeCompare(b.firstName, "en", { sensitivity: "base" });
}

/** The teacher as their students see them: the name they chose, or their first name. */
export function teacherName(t: { firstName: string; teacherDisplayName: string | null }): string {
  return t.teacherDisplayName?.trim() || t.firstName;
}
