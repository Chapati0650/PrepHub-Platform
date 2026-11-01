"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createCheckoutSession, type Plan } from "@/lib/billing";
import { FUNNEL_EVENTS, track } from "@/lib/analytics/track";
import { BillingError } from "@/lib/billing/errors";
import { getAccessContext } from "@/lib/entitlements";

export type ActionState = { error?: string };

export async function subscribeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const plan = formData.get("plan");
  if (plan !== "MONTHLY" && plan !== "ANNUAL") {
    return { error: "Invalid plan." };
  }

  // A subscription only ever unlocks the student experience. A teacher or the
  // Owner could otherwise buy one that does nothing, and an administrator
  // already has Premium unconditionally (createCheckoutSession would refuse
  // them anyway, but with a message about Billing that doesn't apply). The
  // role is read from the database, not the session token, which can trail a
  // change of role.
  const { user } = await getAccessContext(session.user.id);
  if (user?.role === "SCHOOL_ADMINISTRATOR") return { error: "Your administrator account already includes Premium." };
  if (user?.role !== "STUDENT") return { error: "Subscriptions are for student accounts. This account doesn't need one." };

  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  void track(FUNNEL_EVENTS.CHECKOUT_STARTED, { userId: session.user.id, path: "/pricing" });
  let checkoutUrl: string;
  try {
    checkoutUrl = await createCheckoutSession(session.user.id, plan satisfies Plan, origin);
  } catch (err) {
    if (err instanceof BillingError) return { error: err.message };
    throw err;
  }

  redirect(checkoutUrl);
}
