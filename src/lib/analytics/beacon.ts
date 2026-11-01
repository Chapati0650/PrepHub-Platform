// What the public page-view beacon (/api/beacon) will record a path as.
//
// The beacon is the one analytics write a browser can trigger without an
// account, so it accepts only the pages that actually mount PageViewBeacon
// (src/components/analytics/page-view-beacon.tsx): the landing page, the
// schools page, signup, the (auth) pages and pricing. Anything else is a
// hand-made request and is dropped, so the table can't be filled with
// arbitrary strings.
//
// A password-reset link carries its token in the path, and the beacon used to
// store the path as sent — so every reset link opened left a live token in
// the analytics table. The token is replaced with the route's placeholder.

const EXACT = new Set(["/", "/login", "/signup", "/schools", "/pricing", "/reset-password"]);
const RESET_WITH_TOKEN = /^\/reset-password\/[^/]+$/;

/** The path to store, or null when the beacon shouldn't record this request. */
export function beaconPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // A trailing slash is the same page; a query string or hash never reaches
  // here (the beacon sends location.pathname), but is cut if it does.
  const path = raw.split(/[?#]/, 1)[0].replace(/(.)\/+$/, "$1");
  if (EXACT.has(path)) return path;
  if (RESET_WITH_TOKEN.test(path)) return "/reset-password/[token]";
  return null;
}
