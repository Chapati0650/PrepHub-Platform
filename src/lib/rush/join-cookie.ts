// Set by middleware when a signed-out visitor opens a friend's challenge
// link, read by /home after they sign up or log in, and cleared by
// middleware the moment a signed-in request reaches the join page. Kept in
// its own file with no Prisma import so middleware (edge runtime) can use it.
export const RUSH_JOIN_COOKIE = "prephub_rush_join";
export const RUSH_JOIN_COOKIE_MAX_AGE = 60 * 60 * 24; // a day: long enough to sign up, short enough to forget
