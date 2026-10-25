// Set by middleware when a signed-out visitor opens a teacher's class link,
// read by /home once they've signed up (and answered onboarding) or logged
// in. The same hand-off as a 1v1 Rush link (lib/rush/join-cookie.ts). No
// Prisma import, so middleware (edge runtime) can use it.
export const CLASS_JOIN_COOKIE = "prephub_class_join";
export const CLASS_JOIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // a week: a student may sign up days after class

/** Join codes are six characters from a fixed alphabet; nothing else is redirected to. */
export const CLASS_JOIN_CODE_SHAPE = /^[A-Za-z0-9]{6}$/;
