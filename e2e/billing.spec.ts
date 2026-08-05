import { test, expect } from "@playwright/test";
import { uniqueEmail, signUpNewStudent, payWithTestCard } from "./helpers";

test.describe("billing (PRD-003)", () => {
  test("full lifecycle: real Stripe checkout, switch plan, cancel, reactivate", async ({ page }) => {
    test.setTimeout(120_000);

    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "11th" });

    await page.getByRole("link", { name: "View Plans" }).click();
    await expect(page).toHaveURL(/\/pricing$/);

    await page.getByRole("button", { name: "Subscribe Monthly" }).click();
    await payWithTestCard(page, email);

    await expect(page.getByText(/you're subscribed/i)).toBeVisible();
    await page.getByRole("link", { name: "Go to Dashboard" }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "Welcome back, Ada" })).toBeVisible();

    // Billing page reflects the purchase
    await page.goto("/billing");
    await expect(page.getByText("Monthly ($25/mo)")).toBeVisible();
    await expect(page.getByText("ACTIVE")).toBeVisible();

    // Switch to Annual — takes effect next renewal, no immediate charge
    await page.getByRole("button", { name: "Switch to Annual ($99/yr)" }).click();
    await expect(page.getByText(/won't be charged anything today/i)).toBeVisible();

    // Cancel, with confirmation dialog
    await page.getByRole("button", { name: "Cancel Subscription" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Cancellation" }).click();
    await expect(page.getByText(/set to end on/i)).toBeVisible();

    // Reactivate — undoes the scheduled cancellation
    await page.getByRole("button", { name: "Reactivate Subscription" }).click();
    await expect(page.getByText("ACTIVE")).toBeVisible();
    await expect(page.getByText(/set to end on/i)).not.toBeVisible();

    // Invalid promo code is rejected
    await page.getByLabel("Promo code").fill("NOT-A-REAL-CODE");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(/isn't valid/i)).toBeVisible();
  });
});
