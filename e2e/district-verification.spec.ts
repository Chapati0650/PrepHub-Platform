import { test, expect } from "@playwright/test";
import { uniqueEmail, getLatestEmailTo, signUpNewStudent } from "./helpers";

// School/district access is hidden from the /access page's UI for now (Owner
// request — launch is self-pay-only), but the underlying verify-school flow
// is still fully functional, so these tests reach it by direct navigation
// instead of clicking through the now-removed directory search UI.
async function verifySchoolEmail(page: import("@playwright/test").Page, schoolEmail: string) {
  await page.goto("/access/verify-school");
  await page.getByLabel("School Email").fill(schoolEmail);
  await page.getByRole("button", { name: "Verify School Email" }).click();
  await expect(page.getByText(/check your school email/i)).toBeVisible();

  const sentEmail = await getLatestEmailTo(schoolEmail);
  const [, verifyUrl] = sentEmail.text.match(/(http:\/\/\S+\/access\/verify-school\/\S+)/) ?? [];
  if (!verifyUrl) throw new Error("Verification link not found in dev email");
  await page.goto(verifyUrl);
}

test.describe("district verification (PRD-002)", () => {
  // Skipped, not deleted: DirectorySearch (./directory-search.tsx) is no
  // longer rendered anywhere now that school access is hidden from the
  // /access page's UI, so there's currently no surface to exercise this
  // browsing/filtering behavior on. The component itself is untouched.
  test.skip("directory search: browsing and prefix filtering", async ({ page }) => {
    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "10th" });

    // Browse mode shows seeded orgs without typing anything.
    await expect(page.getByText("Frisco ISD")).toBeVisible();
    await expect(page.getByText("PrepHub available").first()).toBeVisible();

    await page.getByLabel("Search schools and districts").fill("frisco");
    await expect(page.getByText("Frisco ISD")).toBeVisible();
    await expect(page.getByText("Independence High School")).not.toBeVisible();

    await page.getByLabel("Search schools and districts").fill("zzzznonexistent");
    await expect(page.getByText(/couldn't find that school/i)).toBeVisible();
  });

  test("individual subscription card routes to pricing", async ({ page }) => {
    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "9th" });

    await page.getByRole("link", { name: "Pay for PrepHub Myself" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test("single-school organization verifies directly, no school selection needed", async ({
    page,
  }) => {
    const email = uniqueEmail();
    const schoolEmail = `student-${Date.now()}@planoacademy.edu`;
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "10th" });

    await verifySchoolEmail(page, schoolEmail);

    await expect(page).toHaveURL(/\/access\/success$/);
    await expect(page.getByText(/at no cost/i)).toBeVisible();

    await page.getByRole("link", { name: "Go to Dashboard" }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "Welcome back, Ada" })).toBeVisible();
  });

  test("multi-school district requires selecting a school before completing", async ({ page }) => {
    const email = uniqueEmail();
    const schoolEmail = `student-${Date.now()}@k12.friscoisd.org`;
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "11th" });

    await verifySchoolEmail(page, schoolEmail);

    await expect(page.getByText(/has multiple schools/i)).toBeVisible();
    await page.getByLabel("Select Your School").click();
    await page.getByRole("option", { name: "Independence High School" }).click();
    await page.getByRole("button", { name: "Finish Verification" }).click();

    await expect(page).toHaveURL(/\/access\/success$/);
  });

  test("rejects a school email whose domain isn't a partner", async ({ page }) => {
    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "9th" });

    await page.goto("/access/verify-school");
    await page.getByLabel("School Email").fill("student@notapartner.example.com");
    await page.getByRole("button", { name: "Verify School Email" }).click();

    await expect(page.getByText(/not currently associated with a prephub partner/i)).toBeVisible();
  });

  test("rejects a school email already linked to another account", async ({ page, browser }) => {
    const firstEmail = uniqueEmail();
    const sharedSchoolEmail = `shared-${Date.now()}@planoacademy.edu`;

    await signUpNewStudent(page, { email: firstEmail, password: "hunter2222", grade: "9th" });
    await verifySchoolEmail(page, sharedSchoolEmail);
    await expect(page).toHaveURL(/\/access\/success$/);

    // A second, different student tries to verify with the same school email.
    // Needs a genuinely separate cookie jar — context.newPage() would share
    // the first student's session and never even reach the signup form.
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    const secondEmail = uniqueEmail();
    await signUpNewStudent(secondPage, { email: secondEmail, password: "hunter2222", grade: "9th" });
    await secondPage.goto("/access/verify-school");
    await secondPage.getByLabel("School Email").fill(sharedSchoolEmail);
    await secondPage.getByRole("button", { name: "Verify School Email" }).click();

    await expect(
      secondPage.getByText(/already connected to another prephub account/i),
    ).toBeVisible();
    await secondContext.close();
  });
});
