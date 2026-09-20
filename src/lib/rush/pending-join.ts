import { cookies } from "next/headers";
import { RUSH_JOIN_COOKIE } from "./join-cookie";

// The friend-challenge code middleware parked in a cookie for a signed-out
// visitor (see middleware.ts), or null. Validated to the code's shape so
// nothing else can be redirected to through it.
export async function readPendingRushCode(): Promise<string | null> {
  const value = (await cookies()).get(RUSH_JOIN_COOKIE)?.value;
  return value && /^[A-Za-z0-9-]{1,12}$/.test(value) ? value : null;
}
