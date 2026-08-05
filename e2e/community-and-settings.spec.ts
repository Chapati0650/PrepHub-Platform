import { test, expect } from "@playwright/test";
import { signInAsOwner, signUpNewStudent, uniqueEmail } from "./helpers";

test.describe("School Community (PRD-009) and Profile & Settings (PRD-010)", () => {
  test("individual student: Community shows the not-applicable state, Settings shows no school info, and theme/notification toggles persist", async ({
    page,
  }) => {
    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "11th" });

    await page.goto("/community");
    await expect(page.getByRole("heading", { name: "School Community is available for school-sponsored students." })).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByText("Verified school")).not.toBeVisible();

    // Appearance: switching to Dark applies the .dark class immediately.
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    // Notifications: toggling and saving persists across a reload.
    const reminderCheckbox = page.getByRole("checkbox", { name: "Daily Practice Reminder" });
    await expect(reminderCheckbox).toBeChecked();
    await reminderCheckbox.click();
    await page.getByRole("button", { name: "Save notification settings" }).click();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Daily Practice Reminder" })).not.toBeChecked();

    // Profile: first name is editable and persists across a reload. (Not
    // checked via /home — this student never resolved /access, and /home
    // redirects there for a diagnostic-not-started, access-unresolved student.)
    await page.getByLabel("First name").fill("Updated Name");
    await page.getByRole("button", { name: "Save name" }).click();
    await page.reload();
    await expect(page.getByLabel("First name")).toHaveValue("Updated Name");

    // Legal links resolve to real pages.
    await page.goto("/settings");
    await page.getByRole("link", { name: "Terms of Service" }).click();
    await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
    await page.goto("/settings");
    await page.getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  });

  test("school-sponsored student: Community shows real aggregate stats and a configured goal; Settings shows school info and no paywall", async ({
    page,
    browser,
  }) => {
    test.setTimeout(60_000);

    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    const studentEmail = uniqueEmail();
    await signUpNewStudent(studentPage, { email: studentEmail, password: "hunter2222", grade: "10th" });

    // Owner: manually activate the student at Plano Academy and set a community goal.
    await signInAsOwner(page);
    await page.goto("/owner/schools");
    await page.getByRole("row", { name: /Plano Academy/ }).getByRole("link", { name: "Open" }).click();
    await expect(page).toHaveURL(/\/owner\/schools\/[a-z0-9]+$/);

    const dialog = page.getByRole("dialog");
    await page.getByRole("button", { name: "Manually Activate Student" }).click();
    await page.getByLabel("Student's PrepHub login email").fill(studentEmail);
    await page
      .getByLabel("School email on record")
      .fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@planoacademy.edu`);
    await page.getByLabel("Grade", { exact: true }).fill("10");
    await page.getByLabel("Expected graduation year").fill(String(new Date().getFullYear() + 3));
    await dialog.getByRole("button", { name: "Activate Student" }).click();
    await expect(page.getByText(studentEmail)).toBeVisible();

    await page.getByLabel("Goal metric").click();
    await page.getByRole("option", { name: "Questions Answered" }).click();
    await page.getByLabel("Goal target").fill("100000");
    await page.getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    // Student: Settings reflects the school membership and school-managed billing.
    await studentPage.goto("/settings");
    await expect(studentPage.getByText("Verified school")).toBeVisible();
    await expect(studentPage.getByText("Plano Academy", { exact: true })).toBeVisible();
    await expect(studentPage.getByText(/access is provided by Plano Academy/)).toBeVisible();
    await expect(studentPage.getByRole("link", { name: "Manage Billing" })).not.toBeVisible();

    // Student: Community page shows real aggregate stats and the configured goal.
    await studentPage.goto("/community");
    await expect(studentPage.getByRole("heading", { name: "Plano Academy" })).toBeVisible();
    await expect(studentPage.getByText("Questions Answered", { exact: true })).toBeVisible();
    await expect(studentPage.getByText(/School Goal: 100,000 Questions Answered/)).toBeVisible();
    // No individual data is ever shown — the page must never mention the student's own name/email.
    await expect(studentPage.getByText(studentEmail)).not.toBeVisible();

    // Dashboard shows the School Community shortcut for a school-sponsored student.
    await studentPage.goto("/home");
    await expect(studentPage.getByRole("link", { name: "View School Community →" })).toBeVisible();

    await studentContext.close();
  });
});
