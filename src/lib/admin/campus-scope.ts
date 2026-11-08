/**
 * Pure rules for a district administrator's campus choice, kept apart from
 * the session and database so every branch can be tested directly.
 */
export type Campus = { id: string; name: string };

/**
 * The campus a district administrator asked for, or null. Only a campus of
 * their own district is ever returned: an id from another district, a
 * non-campus organization or a guess resolves to null, never to a fallback
 * (a wrong id must not quietly show a different campus's data, or let a write
 * land there).
 */
export function resolveDistrictCampus(campuses: readonly Campus[], requestedId: string | null | undefined): Campus | null {
  if (!requestedId) return null;
  return campuses.find((c) => c.id === requestedId) ?? null;
}
