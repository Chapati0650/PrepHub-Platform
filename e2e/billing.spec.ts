import { test, expect } from "@playwright/test";
import { uniqueEmail, signUpNewStudent, payWithTestCard } from "./helpers";

test.describe("billing (PRD-003)", () => {
  test("full lifecycle: real Stripe checkout, switch plan, cancel, reactivate", async ({ page }) => {
    test.setTimeout(120_000);

    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "11th" });

    // Pricing is reachable before the Diagnostic; nothing forces it first.
    await page.goto("/pricing");
    await expect(page).toHaveURL(/\/pricing$/);

    await page.getByRole("button", { name: "Subscribe Monthly" }).click();
    await payWithTestCard(page, email);

    await expect(page.getByText(/you're subscribed/i)).toBeVisible();
    await page.getByRole("link", { name: "Go to Dashboard" }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: /Welcome, Ada/ })).toBeVisible();

    // Billing page reflects the purchase
    await page.goto("/billing");
    await expect(page.getByText("Monthly · $25/month")).toBeVisible();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    // Switch to Annual — scheduled for the renewal through a Stripe
    // Subscription Schedule, so nothing is charged today.
    await page.getByRole("button", { name: "Switch to Annual · $99/year" }).click();
    await page.getByRole("button", { name: "Schedule the switch" }).click();
    await expect(page.getByText(/Switches to Annual on/).first()).toBeVisible();

    // Cancel, with confirmation dialog
    await page.getByRole("button", { name: "Cancel Subscription" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Cancellation" }).click();
    await expect(page.getByText(/set to end on/i)).toBeVisible();

    // Reactivate — undoes the scheduled cancellation
    await page.getByRole("button", { name: "Reactivate Subscription" }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText(/set to end on/i)).not.toBeVisible();

    // Invalid promo code is rejected
    await page.getByLabel("Promo code").fill("NOT-A-REAL-CODE");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(/isn't valid/i)).toBeVisible();
  });
});
