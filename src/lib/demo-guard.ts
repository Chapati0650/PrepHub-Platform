import { auth } from "@/auth";
import { isSharedDemoLogin } from "@/lib/demo-account";

/**
 * Shared demo logins (2026-11-09). Everyone a district sends the demo to signs in as the same five
 * people, so an action that removes or breaks something would change the demo for the next person:
 * deleting Maya's account, Maya leaving her class, Ms. Rivera removing students or archiving a class,
 * the district admin removing a teacher. Those actions return this message instead (the confirm
 * dialogs show a returned `error`). Everything that only adds (assigning homework, running a Guided
 * Session, practicing) still works.
 */
export const DEMO_LOCKED_MESSAGE = "Not available on a shared demo login: it would change the demo for everyone else trying it.";

export async function isDemoSession(): Promise<boolean> {
  const session = await auth();
  return isSharedDemoLogin(session?.user?.email);
}
