/**
 * Centralized feature flags (CLAUDE.md: "config that can change behavior over
 * time ... is centralized and versioned"). A flag here hides a surface from
 * the *student experience* — it never deletes data and never changes what the
 * engine computes, so flipping one back on restores the feature intact.
 */

/**
 * College Apps (tracker, deadlines, supplements) is hidden from students
 * (Owner, 2026-10-13: "we have enough on our plate in terms of SAT related
 * things"). The tables, the library in `src/lib/college-apps/` and the Owner
 * CMS at /owner/content/supplements all stay — a student's existing tracker
 * rows are untouched and come back exactly as they were when this flips to
 * true. Student-facing routes under /college-apps redirect to /home while
 * this is false rather than 404ing, so any link already shared still lands
 * somewhere sensible.
 */
export const COLLEGE_APPS_ENABLED = false;
