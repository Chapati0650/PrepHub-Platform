import { cookies } from "next/headers";
import { CLASS_JOIN_COOKIE, CLASS_JOIN_CODE_SHAPE } from "./join-cookie";

// The class code middleware parked in a cookie for a signed-out visitor (see
// middleware.ts), or null. Validated to the code's shape so nothing else can
// be redirected to through it. Middleware clears it on the first signed-in
// request to the join page.
export async function readPendingClassCode(): Promise<string | null> {
  const value = (await cookies()).get(CLASS_JOIN_COOKIE)?.value;
  return value && CLASS_JOIN_CODE_SHAPE.test(value) ? value : null;
}
