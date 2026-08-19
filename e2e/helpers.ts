import { type Page, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const OUTBOX_PATH = path.join(process.cwd(), ".dev-emails.jsonl");

export async function getLatestEmailTo(email: string): Promise<{ subject: string; text: string }> {
  const raw = await readFile(OUTBOX_PATH, "utf-8").catch(() => "");
  const lines = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { to: string; subject: string; text: string });
  const match = [...lines].reverse().find((entry) => entry.to === email);
  if (!match) throw new Error(`No dev email found for ${email}`);
  return match;
}

export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Signs up a fresh student, then drives the post-signup onboarding wizard
 *  (grade/target score/study commitment) to completion. Lands on /access —
 *  a new account has no subscription or school membership yet (PRD-002
 *  §5.1). Grade is collected in the wizard, not the signup form itself. */
export async function signUpNewStudent(
  page: Page,
  { email, password, grade }: { email: string; password: string; grade: "9th" | "10th" | "11th" | "12th" },
) {
  await page.goto("/signup");
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("checkbox", { name: "I confirm I am 13 years of age or older" }).click();
  await page.getByRole("checkbox", { name: "I agree to the Terms of Service" }).click();
  await page.getByRole("checkbox", { name: "I agree to the Privacy Policy" }).click();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Continue" }).click(); // Welcome

  await page.getByRole("button", { name: `${grade} Grade` }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // Grade

  await page.getByRole("button", { name: "I'm not sure yet" }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // Target Score

  await page.getByRole("button", { name: /10–15 minutes a day/ }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // Study Commitment

  await expect(page).toHaveURL(/\/access$/);
}

/** Logs in as the Owner account provisioned by `npx prisma db seed` (see
 *  prisma/seed.ts) — override via OWNER_TEST_EMAIL/OWNER_TEST_PASSWORD if the
 *  local DB was seeded with non-default OWNER_EMAIL/OWNER_PASSWORD. */
export async function signInAsOwner(page: Page) {
  const email = process.env.OWNER_TEST_EMAIL ?? "owner@prephub.dev";
  const password = process.env.OWNER_TEST_PASSWORD ?? "dev-owner-password-change-me";

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** Fills out Stripe's real hosted test-mode Checkout page with a test card
 *  and submits. All fields live in the top-level document (no cross-origin
 *  iframe hopping needed) — confirmed by inspecting the live page directly. */
export async function payWithTestCard(page: Page, billingEmail: string) {
  await expect(page).toHaveURL(/checkout\.stripe\.com/, { timeout: 15_000 });

  await page.locator("#email").fill(billingEmail);
  await page.locator("#payment-method-accordion-item-title-card").click({ force: true });
  await page.locator("#cardNumber").fill("4242424242424242");
  await page.locator("#cardExpiry").fill("12/34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("Test Student");
  const zip = page.locator("#billingPostalCode");
  if (await zip.isVisible().catch(() => false)) {
    await zip.fill("12345");
  }

  // Checked by default; requires a valid phone number to proceed, which
  // otherwise silently blocks submission with no visible error.
  const saveInfo = page.getByLabel("Save my information for faster checkout");
  if (await saveInfo.isChecked().catch(() => false)) {
    await saveInfo.uncheck({ force: true });
  }

  await page.getByRole("button", { name: /subscribe/i }).click();
  await expect(page).toHaveURL(/\/billing\/success/, { timeout: 30_000 });
}

export function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
