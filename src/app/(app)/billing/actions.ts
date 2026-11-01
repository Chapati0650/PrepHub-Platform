"use server";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  cancelSubscription,
  reactivateSubscription,
  switchPlan,
  applyPromoCode,
} from "@/lib/billing";
import { BillingError } from "@/lib/billing/errors";
import { PLAN_NAME } from "@/lib/billing/display";

export type ActionState = { error?: string; success?: boolean; message?: string };

// Billing and Settings both show the plan, so both are re-rendered after any
// change to it — otherwise "Current plan" kept the old answer until a reload.
function refreshPlanPages() {
  revalidatePath("/billing");
  revalidatePath("/settings");
}

async function run(change: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await change();
    refreshPlanPages();
    return message ? { success: true, message } : { success: true };
  } catch (err) {
    if (err instanceof BillingError) {
      // The state behind the refusal may be news to this page (a switch made
      // in another tab, a cancellation from Stripe), so it is redrawn too.
      refreshPlanPages();
      return { error: err.message };
    }
    throw err;
  }
}

export async function cancelSubscriptionAction(): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");
  const userId = session.user.id;
  return run(() => cancelSubscription(userId));
}

export async function reactivateSubscriptionAction(): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");
  const userId = session.user.id;
  return run(() => reactivateSubscription(userId));
}

// Called directly rather than as a form action, so the plan arrives as an
// argument — which a browser can set to anything, hence the check.
export async function switchPlanAction(plan: unknown): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");
  const userId = session.user.id;
  if (plan !== "MONTHLY" && plan !== "ANNUAL") return { error: "Choose Monthly or Annual." };

  return run(async () => {
    const result = await switchPlan(userId, plan);
    return result.kind === "KEPT"
      ? `You'll stay on ${PLAN_NAME[result.plan]}. The switch is off.`
      : `Switch scheduled. You stay on your current plan until then, and nothing is charged today.`;
  });
}

export async function applyPromoCodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");
  const userId = session.user.id;

  const code = formData.get("code");
  if (typeof code !== "string" || !code.trim()) {
    return { error: "Enter a promo code." };
  }

  return run(() => applyPromoCode(userId, code.trim()));
}
