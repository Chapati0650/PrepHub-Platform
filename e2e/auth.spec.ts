import { test, expect } from "@playwright/test";
import { uniqueEmail, getLatestEmailTo, signUpNewStudent } from "./helpers";

test.describe("authentication (PRD-001)", () => {
  test("sign up, log out, log back in", async ({ page }) => {
    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "11th" });

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // unauthenticated again — /home must redirect back to /login
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("hunter2222");
    await page.getByRole("button", { name: "Log in", exact: true }).click();

    // still hasn't chosen an access method, so login also lands on /access
    await expect(page).toHaveURL(/\/access$/);
    await expect(page.getByRole("heading", { name: "Choose how you'll access PrepHub" })).toBeVisible();
  });

  test("rejects signup with a duplicate email", async ({ page }) => {
    const email = uniqueEmail();

    async function fillSignupForm() {
      await page.getByLabel("First name").fill("Ada");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill("hunter2222");
      await page.getByLabel("Grade").click();
      await page.getByRole("option", { name: "9th grade" }).click();
      await page.getByRole("checkbox", { name: "I confirm I am 13 years of age or older" }).click();
      await page.getByRole("checkbox", { name: "I agree to the Terms of Service" }).click();
      await page.getByRole("checkbox", { name: "I agree to the Privacy Policy" }).click();
      await page.getByRole("button", { name: "Create account" }).click();
    }

    await page.goto("/signup");
    await fillSignupForm();
    await expect(page).toHaveURL(/\/access$/);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/signup");
    await fillSignupForm();
    await expect(page.getByText(/already exists/i)).toBeVisible();
  });

  test("rejects login with the wrong password", async ({ page }) => {
    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "10th" });
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
  });

  test("password reset: request link, set new password, log in with it", async ({ page }) => {
    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "original-pw1", grade: "12th" });
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/reset-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible();

    const sentEmail = await getLatestEmailTo(email);
    const [, resetUrl] = sentEmail.text.match(/(http:\/\/\S+\/reset-password\/\S+)/) ?? [];
    if (!resetUrl) throw new Error("Reset link not found in dev email");

    await page.goto(resetUrl);
    await page.getByLabel("New password").fill("brand-new-pw1");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // old password must no longer work
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("original-pw1");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByText(/incorrect email or password/i)).toBeVisible();

    // new password works
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("brand-new-pw1");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/access$/);
  });

  test("self-service account deletion requires the correct password and then blocks login", async ({
    page,
  }) => {
    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "delete-me-pw1", grade: "9th" });

    await page.goto("/settings");
    await page.getByLabel("Confirm your password").fill("wrong-password");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByText(/incorrect password/i)).toBeVisible();

    await page.getByLabel("Confirm your password").fill("delete-me-pw1");
    await page.getByRole("button", { name: "Delete my account" }).click();
    // Deletion signs the student out via signOut({ redirectTo: "/" }); the
    // bare root route itself has no content — it redirects unauthenticated
    // visitors straight to /login.
    await expect(page).toHaveURL("http://localhost:3000/login");

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("delete-me-pw1");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
  });
});
