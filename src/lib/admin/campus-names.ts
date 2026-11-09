/**
 * Campus names as a district page lists them (2026-11-09): without the district's own prefix when every
 * campus shares one ("Houston ISD Demo – Bayou High School" → "Bayou High School"), so five chips or
 * 270 table rows don't all start with the same words. Only a prefix that ends at a separator (" – ",
 * " - ", ": ") is removed, and only when every name has it and something is left after it.
 */
const SEPARATORS = [" \u2013 ", " \u2014 ", " - ", ": "];

export function shortCampusName(name: string, all: string[]): string {
  if (all.length < 2) return name;
  for (const sep of SEPARATORS) {
    const at = name.indexOf(sep);
    if (at <= 0) continue;
    const prefix = name.slice(0, at + sep.length);
    if (all.every((n) => n.startsWith(prefix) && n.length > prefix.length)) return name.slice(prefix.length);
  }
  return name;
}
