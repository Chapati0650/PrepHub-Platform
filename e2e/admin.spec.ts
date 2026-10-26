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
    await dialog.getByLabel("First name").fill("Staff");
    await dialog.getByLabel("Email").fill(adminEmail);
    await dialog.getByLabel("Password").fill(adminPassword);
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
    // An administrator signs in to their school's Overview, not the student dashboard.
    await expect(adminPage).toHaveURL(/\/admin$/);

    // The administrator-only nav is visible; a plain student never sees it.
    const adminNav = adminPage.getByRole("navigation");
    await expect(adminNav.getByRole("link", { name: "Overview", exact: true })).toBeVisible();
    await expect(adminNav.getByRole("link", { name: "Students", exact: true })).toBeVisible();
    await expect(adminNav.getByRole("link", { name: "Announcements", exact: true })).toBeVisible();
    await expect(adminNav.getByRole("link", { name: "Access & support", exact: true })).toBeVisible();
    await expect(studentPage.getByRole("link", { name: "Access & support" })).not.toBeVisible();

    // Overview: registration against enrollment, and an honest empty state for score growth.
    await expect(adminPage.getByRole("heading", { name: schoolName })).toBeVisible();
    await expect(adminPage.getByText("10% of 10 enrolled")).toBeVisible();
    await expect(adminPage.getByText(/^Nothing to compare yet\./)).toBeVisible();

    // Student Directory: search, filter, and edit first name/graduation year.
    await adminPage.goto("/admin/students");
    const studentRow = adminPage.getByRole("row", { name: new RegExp(verifiedSchoolEmail) });
    await expect(studentRow).toBeVisible();
    await expect(studentRow.getByText(String(graduationYear))).toBeVisible();

    await adminPage.getByLabel("Find a student").fill("Ada");
    await expect(studentRow).toBeVisible();
    await adminPage.getByLabel("Find a student").fill("no-such-student-xyz");
    await expect(adminPage.getByText("No students match these filters. Try clearing them.")).toBeVisible();
    await adminPage.getByLabel("Find a student").fill("");

    await studentRow.getByRole("button", { name: "Edit" }).click();
    await adminPage.getByLabel("First name").fill("Beatrice");
    const newGraduationYear = graduationYear + 1;
    // Scoped to the spinbutton, not a bare label match — the filter panel's
    // "Class of" <Select> shares the same accessible name.
    await adminPage.getByRole("spinbutton", { name: "Class of" }).fill(String(newGraduationYear));
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByRole("cell", { name: "Beatrice" })).toBeVisible();
    // Scoped to the row: on a phone the same student also appears in a
    // stacked list (hidden at this width), which carries the year too.
    await expect(
      adminPage.getByRole("row", { name: new RegExp(verifiedSchoolEmail) }).getByText(String(newGraduationYear)),
    ).toBeVisible();

    // Announcements: create, preview, publish (with email delivery), then remove.
    await adminPage.goto("/admin/announcements");
    await adminPage.getByLabel("Title").fill("Welcome Back!");
    await adminPage.getByLabel("Message").fill("Good luck on your practice this week.");
    await adminPage.getByRole("button", { name: "Preview before sending" }).click();
    // The preview shows both places it lands: the home-page banner and the email.
    await expect(adminPage.getByText("Welcome Back!").first()).toBeVisible();
    await adminPage.getByRole("button", { name: "Send to 1 student" }).click();
    // The form coming back as "Write an announcement" only happens once the
    // send (including email delivery) has fully resolved — a stronger signal
    // than the announcement text, which the preview satisfies immediately.
    await expect(adminPage.getByRole("heading", { name: "Write an announcement" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Showing to students now" })).toBeVisible();
    await expect(adminPage.getByText("Welcome Back!").first()).toBeVisible();

    const email = await getLatestEmailTo(verifiedSchoolEmail);
    expect(email.subject).toContain("Welcome Back!");
    expect(email.text).toContain("Good luck on your practice this week.");

    // Student: sees the announcement inside PrepHub, on the Dashboard.
    await studentPage.goto("/home");
    await expect(studentPage.getByText("Welcome Back!")).toBeVisible();
    await expect(studentPage.getByText("Good luck on your practice this week.")).toBeVisible();

    // Administrator removes it; it moves out of Active and off the student's Dashboard.
    // Removing asks first, saying what it does and what it can't undo.
    await adminPage.getByRole("button", { name: "Remove" }).click();
    await adminPage.getByRole("dialog").getByRole("button", { name: "Remove announcement" }).click();
    await expect(adminPage.getByText(/^No announcements are showing right now\./)).toBeVisible();
    await studentPage.goto("/home");
    await expect(studentPage.getByText("Welcome Back!")).not.toBeVisible();

    // School Access & Support.
    await adminPage.goto("/admin/access");
    await expect(adminPage.getByText("Active", { exact: true })).toBeVisible();
    await expect(adminPage.getByRole("link", { name: /schools@prephubtp\.com/ })).toBeVisible();

    // The administrator can also use the full student product for evaluation.
    await adminPage.goto("/diagnostic");
    await expect(adminPage).toHaveURL(/\/diagnostic/);

    await studentContext.close();
    await adminContext.close();
  });
});
