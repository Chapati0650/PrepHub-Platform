"use client";

import { useSearchParams } from "next/navigation";

/**
 * The hidden `school` field of a write form nested too deep to be handed the
 * campus as a prop: the campus the page is showing. It is only a request;
 * every action re-checks it against the administrator's own district.
 */
export function CampusField() {
  const school = useSearchParams().get("school");
  return school ? <input type="hidden" name="school" value={school} /> : null;
}
