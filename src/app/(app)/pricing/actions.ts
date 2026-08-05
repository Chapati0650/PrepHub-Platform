"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createCheckoutSession, type Plan } from "@/lib/billing";
import { BillingError } from "@/lib/billing/errors";

export type ActionState = { error?: string };

export async function subscribeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const plan = formData.get("plan");
  if (plan !== "MONTHLY" && plan !== "ANNUAL") {
    return { error: "Invalid plan." };
  }

  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  let checkoutUrl: string;
  try {
    checkoutUrl = await createCheckoutSession(session.user.id, plan satisfies Plan, origin);
  } catch (err) {
    if (err instanceof BillingError) return { error: err.message };
    throw err;
  }

  redirect(checkoutUrl);
}
