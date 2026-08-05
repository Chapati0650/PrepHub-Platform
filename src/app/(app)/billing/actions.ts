"use server";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  cancelSubscription,
  reactivateSubscription,
  switchPlan,
  applyPromoCode,
  type Plan,
} from "@/lib/billing";
import { BillingError } from "@/lib/billing/errors";

export type ActionState = { error?: string; success?: boolean };

export async function cancelSubscriptionAction(): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  try {
    await cancelSubscription(session.user.id);
  } catch (err) {
    if (err instanceof BillingError) return { error: err.message };
    throw err;
  }
  return { success: true };
}

export async function reactivateSubscriptionAction(): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  try {
    await reactivateSubscription(session.user.id);
  } catch (err) {
    if (err instanceof BillingError) return { error: err.message };
    throw err;
  }
  return { success: true };
}

export async function switchPlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const plan = formData.get("plan");
  if (plan !== "MONTHLY" && plan !== "ANNUAL") {
    return { error: "Invalid plan." };
  }

  try {
    await switchPlan(session.user.id, plan satisfies Plan);
  } catch (err) {
    if (err instanceof BillingError) return { error: err.message };
    throw err;
  }
  return { success: true };
}

export async function applyPromoCodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const code = formData.get("code");
  if (typeof code !== "string" || !code.trim()) {
    return { error: "Enter a promo code." };
  }

  try {
    await applyPromoCode(session.user.id, code.trim());
  } catch (err) {
    if (err instanceof BillingError) return { error: err.message };
    throw err;
  }
  return { success: true };
}
