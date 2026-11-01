/**
 * Limits for classes and homework, in one place (CLAUDE.md: config that
 * shapes behaviour is centralized).
 */

/** Long enough for a unit's worth of practice; short enough to finish in one sitting. */
export const ASSIGNMENT_MAX_QUESTIONS = 30;
export const CLASSROOM_NAME_MAX = 80;
export const ASSIGNMENT_TITLE_MAX = 120;
export const ASSIGNMENT_INSTRUCTIONS_MAX = 2000;

/** Question-bank search results per page in the assignment builder. */
export const QUESTION_BANK_PAGE_SIZE = 20;

/** A teacher's classes, before an archive is the only way to make room. */
export const CLASSROOMS_PER_TEACHER_MAX = 40;

/** A student's last name as given to a class, and a teacher's name for students. */
export const LAST_NAME_MAX = 60;
export const TEACHER_DISPLAY_NAME_MAX = 60;

/**
 * The day-before reminder: queued for homework due within this many hours
 * of the daily run (22:00 UTC, 4 or 5pm Central). Homework due at the end of
 * tomorrow is 31–32 hours away then, and homework due the day after is at
 * least 55, so anything from 33 to 54 picks out exactly "due tomorrow" (or
 * tonight, for homework set too late for yesterday's run).
 */
export const HOMEWORK_REMINDER_WINDOW_HOURS = 36;
/**
 * No reminder for homework assigned this recently: its students were just
 * emailed that it exists.
 */
export const HOMEWORK_REMINDER_MIN_AGE_HOURS = 20;
/**
 * A teacher's own "Remind the N who haven't finished": once per homework in
 * this many hours. Enough to chase a class the morning after the deadline
 * and again the next day; not enough to fill a student's inbox, or to cost
 * the sending domain the reputation every password reset depends on.
 */
export const HOMEWORK_NUDGE_COOLDOWN_HOURS = 24;
