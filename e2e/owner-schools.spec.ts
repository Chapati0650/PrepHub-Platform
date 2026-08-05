import { test, expect } from "@playwright/test";
import { uniqueEmail, signUpNewStudent, signInAsOwner, todayPlusDays } from "./helpers";

test.describe("Owner schools management (PRD-017 §18)", () => {
  test("a non-owner is redirected away from /owner/schools", async ({ page }) => {
    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "10th" });

    await page.goto("/owner/schools");
    await expect(page).not.toHaveURL(/\/owner/);
  });

  test("Owner sees seeded organizations in the directory", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/owner/schools");
    await expect(page.getByRole("cell", { name: "Frisco ISD" })).toBeVisible();
  });

  test("full organization lifecycle: create, activate, suspend, archive, administrators, add a school", async ({
    page,
  }) => {
    await signInAsOwner(page);
    await page.goto("/owner/schools");

    // Every "Create X" / "Add X" dialog's trigger button and its submit
    // button share identical accessible text — scope the submit click to the
    // open dialog itself, since a bare name locator is ambiguous between them.
    const dialog = page.getByRole("dialog");

    const orgName = `E2E Test District ${Date.now()}`;
    await page.getByRole("button", { name: "Create Organization" }).click();
    await page.getByLabel("Type").click();
    await page.getByRole("option", { name: "District" }).click();
    await page.getByLabel("Official name").fill(orgName);
    await page.getByLabel("City").fill("Testville");
    await page.getByLabel("State").fill("TX");
    await page.getByLabel("School year").fill("2026-2027");
    await page.locator("#contractStartDate").fill(todayPlusDays(-1));
    await page.locator("#contractEndDate").fill(todayPlusDays(365));
    await dialog.getByRole("button", { name: "Create Organization" }).click();

    // Redirected to the new org's detail page
    await expect(page).toHaveURL(/\/owner\/schools\/[a-z0-9]+$/);
    await expect(page.getByText("SETUP")).toBeVisible();

    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Suspend" }).click();
    await expect(page.getByText("SUSPENDED")).toBeVisible();

    // Administrators
    const adminEmail = uniqueEmail();
    await page.getByRole("button", { name: "Create Administrator" }).click();
    await page.getByLabel("First name").fill("Pat");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill("adminpass123");
    await dialog.getByRole("button", { name: "Create Administrator" }).click();
    await expect(page.getByText(adminEmail)).toBeVisible();

    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText(adminEmail)).not.toBeVisible();

    // Add a school under this district
    const schoolName = `E2E Test High ${Date.now()}`;
    await page.getByRole("button", { name: "Add School" }).click();
    await page.getByLabel("School name").fill(schoolName);
    await dialog.getByRole("button", { name: "Add School" }).click();
    await expect(page.getByText(schoolName)).toBeVisible();

    // Archive
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("ARCHIVED")).toBeVisible();
  });

  test("student membership management: manual activation, remove, restore, and transfer", async ({
    page,
    browser,
  }) => {
    // A fresh student, signed up in an isolated context (separate cookie jar
    // from the Owner session in `page`).
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    const studentEmail = uniqueEmail();
    await signUpNewStudent(studentPage, { email: studentEmail, password: "hunter2222", grade: "10th" });
    await studentContext.close();

    await signInAsOwner(page);
    await page.goto("/owner/schools");
    await page.getByRole("row", { name: /Plano Academy/ }).getByRole("link", { name: "Open" }).click();
    await expect(page).toHaveURL(/\/owner\/schools\/[a-z0-9]+$/);

    const dialog = page.getByRole("dialog");
    await page.getByRole("button", { name: "Manually Activate Student" }).click();
    await page.getByLabel("Student's PrepHub login email").fill(studentEmail);
    await page.getByLabel("School email on record").fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@planoacademy.edu`);
    await page.getByLabel("Grade", { exact: true }).fill("10");
    await page.getByLabel("Expected graduation year").fill("2028");
    await dialog.getByRole("button", { name: "Activate Student" }).click();

    // This detail page accumulates real rows across every past e2e run against
    // this local DB, so actions must be scoped to this student's own row —
    // a bare "Remove"/"Transfer" locator is ambiguous once enough tests have run.
    const row = page.getByRole("row", { name: new RegExp(studentEmail) });
    await expect(row).toBeVisible();

    // Remove, then restore
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(row.getByText("REMOVED")).toBeVisible();
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(row.getByText("ACTIVE", { exact: true })).toBeVisible();

    // Transfer to a different school
    await row.getByRole("button", { name: "Transfer" }).click();
    await page.getByLabel("New school", { exact: true }).click();
    await page.getByRole("option", { name: "Frisco High School" }).click();
    await page.getByLabel("New school email").fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@k12.friscoisd.org`);
    await dialog.getByRole("button", { name: "Resolve Transfer" }).click();

    // No longer listed at the old school...
    await expect(page.getByText(studentEmail)).not.toBeVisible();

    // ...and now appears at the new one.
    await page.goto("/owner/schools");
    await page
      .getByRole("row", { name: /Frisco High School/ })
      .getByRole("link", { name: "Open" })
      .click();
    await expect(page.getByText(studentEmail)).toBeVisible();
  });
});
