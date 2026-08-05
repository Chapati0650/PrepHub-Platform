import { test, expect } from "@playwright/test";
import { uniqueEmail, signUpNewStudent, signInAsOwner, todayPlusDays, getLatestEmailTo } from "./helpers";

test.describe("School Administrator (PRD-011)", () => {
  test("a non-administrator is redirected away from /admin", async ({ page }) => {
    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "10th" });

    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/);
  });

  test("full administrator flow: overview, student directory, announcements, and access & support", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);

    // A fresh student login account, signed up in its own context — the
    // Owner will link a StudentMembership to it below via manual activation.
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    const studentEmail = uniqueEmail();
    await signUpNewStudent(studentPage, { email: studentEmail, password: "hunter2222", grade: "10th" });
    const verifiedSchoolEmail = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2eadminschool.edu`;

    // Owner: create and activate a fresh, isolated SCHOOL org (so enrollment/
    // registration math below is exact, unlike the shared seeded orgs other
    // specs also add students to).
    await signInAsOwner(page);
    await page.goto("/owner/schools");
    const dialog = page.getByRole("dialog");

    const schoolName = `E2E Admin Test School ${Date.now()}`;
    await page.getByRole("button", { name: "Create Organization" }).click();
    await page.getByLabel("Official name").fill(schoolName);
    await page.getByLabel("City").fill("Testville");
    await page.getByLabel("State").fill("TX");
    await page.getByLabel("School year").fill("2026-2027");
    await page.locator("#contractStartDate").fill(todayPlusDays(-1));
    await page.locator("#contractEndDate").fill(todayPlusDays(365));
    await dialog.getByRole("button", { name: "Create Organization" }).click();
    await expect(page).toHaveURL(/\/owner\/schools\/[a-z0-9]+$/);

    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();

    // Total School Enrollment: 10, so registering 1 student reads as exactly 10%.
    await page.getByLabel("Total School Enrollment").fill("10");
    await page.getByRole("button", { name: "Save enrollment" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    // Create the shared School Administrator account.
    const adminEmail = uniqueEmail();
    const adminPassword = "adminpass123";
    await page.getByRole("button", { name: "Create Administrator" }).click();
    await page.getByLabel("First name").fill("Staff");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(adminPassword);
    await dialog.getByRole("button", { name: "Create Administrator" }).click();
    await expect(page.getByText(adminEmail)).toBeVisible();

    // Manually activate the one registered student at this school.
    await page.getByRole("button", { name: "Manually Activate Student" }).click();
    await page.getByLabel("Student's PrepHub login email").fill(studentEmail);
    await page.getByLabel("School email on record").fill(verifiedSchoolEmail);
    await page.getByLabel("Grade", { exact: true }).fill("10");
    const graduationYear = new Date().getFullYear() + 2;
    await page.getByLabel("Expected graduation year").fill(String(graduationYear));
    await dialog.getByRole("button", { name: "Activate Student" }).click();
    await expect(page.getByText(studentEmail)).toBeVisible();

    // Administrator: signs in in its own context.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/login");
    await adminPage.getByLabel("Email").fill(adminEmail);
    await adminPage.getByLabel("Password").fill(adminPassword);
    await adminPage.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(adminPage).toHaveURL(/\/home$/);

    // The administrator-only nav is visible; a plain student never sees it.
    await expect(adminPage.getByRole("link", { name: "Admin Overview" })).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "Student Directory" })).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "Announcements" })).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "School Access & Support" })).toBeVisible();
    await expect(studentPage.getByRole("link", { name: "Admin Overview" })).not.toBeVisible();

    // Admin Overview: enrollment/registration math and all-time activity totals.
    await adminPage.goto("/admin");
    await expect(adminPage.getByRole("heading", { name: schoolName })).toBeVisible();
    await expect(adminPage.getByText("10", { exact: true })).toBeVisible(); // Total School Enrollment
    await expect(adminPage.getByText("1", { exact: true })).toBeVisible(); // Registered PrepHub Students
    await expect(adminPage.getByText("10%", { exact: true })).toBeVisible(); // Registration Percentage
    await expect(
      adminPage.getByText("Your students have not completed any practice activity yet."),
    ).toBeVisible();

    // Student Directory: search, filter, and edit first name/graduation year.
    await adminPage.goto("/admin/students");
    const studentRow = adminPage.getByRole("row", { name: new RegExp(verifiedSchoolEmail) });
    await expect(studentRow).toBeVisible();
    await expect(studentRow.getByText(String(graduationYear))).toBeVisible();

    await adminPage.getByLabel("Search").fill("Ada");
    await expect(studentRow).toBeVisible();
    await adminPage.getByLabel("Search").fill("no-such-student-xyz");
    await expect(adminPage.getByText("No students match these filters.")).toBeVisible();
    await adminPage.getByLabel("Search").fill("");

    await studentRow.getByRole("button", { name: "Edit" }).click();
    await adminPage.getByLabel("First Name").fill("Beatrice");
    const newGraduationYear = graduationYear + 1;
    // Scoped to the spinbutton, not a bare label match — the filter panel's
    // "Graduation Year" <Select> shares the same accessible name.
    await adminPage.getByRole("spinbutton", { name: "Graduation Year" }).fill(String(newGraduationYear));
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByRole("cell", { name: "Beatrice" })).toBeVisible();
    await expect(adminPage.getByText(String(newGraduationYear))).toBeVisible();

    // Announcements: create, preview, publish (with email delivery), then remove.
    await adminPage.goto("/admin/announcements");
    await adminPage.getByLabel("Title").fill("Welcome Back!");
    await adminPage.getByLabel("Message").fill("Good luck on your practice this week.");
    await adminPage.getByRole("button", { name: "Preview" }).click();
    await expect(adminPage.getByText("Welcome Back!")).toBeVisible();
    await adminPage.getByRole("button", { name: "Publish" }).click();
    // The create form reverting from Preview back to "New Announcement" only
    // happens once the publish action (including email delivery) has fully
    // resolved — a stronger signal than the announcement text being visible,
    // which the still-rendering Preview box would satisfy immediately.
    await expect(adminPage.getByText("New Announcement")).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Active Announcements" })).toBeVisible();
    await expect(adminPage.getByText("Welcome Back!").first()).toBeVisible();

    const email = await getLatestEmailTo(verifiedSchoolEmail);
    expect(email.subject).toContain("Welcome Back!");
    expect(email.text).toContain("Good luck on your practice this week.");

    // Student: sees the announcement inside PrepHub, on the Dashboard.
    await studentPage.goto("/home");
    await expect(studentPage.getByText("Welcome Back!")).toBeVisible();
    await expect(studentPage.getByText("Good luck on your practice this week.")).toBeVisible();

    // Administrator removes it; it moves out of Active and off the student's Dashboard.
    await adminPage.getByRole("button", { name: "Remove" }).click();
    await expect(adminPage.getByText("No announcements have been published.")).toBeVisible();
    await studentPage.goto("/home");
    await expect(studentPage.getByText("Welcome Back!")).not.toBeVisible();

    // School Access & Support.
    await adminPage.goto("/admin/access");
    await expect(adminPage.getByText("Active", { exact: true })).toBeVisible();
    await expect(adminPage.getByRole("link", { name: /support@/ })).toBeVisible();

    // The administrator can also use the full student product for evaluation.
    await adminPage.goto("/diagnostic");
    await expect(adminPage).toHaveURL(/\/diagnostic/);

    await studentContext.close();
    await adminContext.close();
  });
});
