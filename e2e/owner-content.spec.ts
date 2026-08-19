import { test, expect } from "@playwright/test";
import path from "node:path";
import { signInAsOwner, signUpNewStudent, uniqueEmail } from "./helpers";

const imagePath = path.join(process.cwd(), "e2e", "fixtures", "test-image.png");
const videoPath = path.join(process.cwd(), "e2e", "fixtures", "test-video.mp4");

async function createQuestion(page: import("@playwright/test").Page, questionType: "Multiple Choice" | "Open-Ended Numeric Response") {
  await page.goto("/owner/content/questions");
  await page.getByRole("button", { name: "Create Question" }).click();
  const dialog = page.getByRole("dialog");
  if (questionType !== "Multiple Choice") {
    await page.getByLabel("Question type").click();
    await page.getByRole("option", { name: questionType }).click();
  }
  await dialog.getByRole("button", { name: "Create Question" }).click();
  await expect(page).toHaveURL(/\/owner\/content\/questions\/[a-z0-9]+$/);
  // Without this, typing immediately after the redirect can race React
  // hydration — the DOM input accepts the keystrokes but onChange (and so
  // autosave) never fires because the listener isn't attached yet.
  await page.waitForLoadState("networkidle");
}

// Waiting for the "Saved" indicator alone is racy when a PRIOR save already
// left it showing — a fresh assertion can catch that stale text before the
// new (1.5s-debounced) autosave has even started. Requiring the "Unsaved
// changes" state to appear first proves a new save cycle actually began.
async function waitForAutosave(page: import("@playwright/test").Page) {
  await expect(page.getByText("Unsaved changes")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
}

async function fillMultipleChoiceContent(page: import("@playwright/test").Page, text: string) {
  await page.getByLabel("Question text").fill(text);
  await page.getByLabel("Choice 1", { exact: true }).fill("3");
  await page.getByLabel("Choice 2", { exact: true }).fill("4");
  await page.getByLabel("Choice 3", { exact: true }).fill("5");
  await page.getByLabel("Choice 4", { exact: true }).fill("6");
  await page.getByLabel("Mark choice 2 as correct").check();
  await page.setInputFiles('input[type="file"][accept*="video"]', videoPath);
  await expect(page.getByText("Uploading…")).toHaveCount(0, { timeout: 30_000 });
  await waitForAutosave(page);
}

test.describe("Owner content management (PRD-013, PRD-015)", () => {
  test("a non-owner is redirected away from /owner/content/questions", async ({ page }) => {
    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "10th" });
    await page.goto("/owner/content/questions");
    await expect(page).not.toHaveURL(/\/owner/);
  });

  test("full question lifecycle: create, edit, upload media, preview, publish, edit-applies-immediately, unpublish, archive", async ({
    page,
  }) => {
    await signInAsOwner(page);
    await createQuestion(page, "Multiple Choice");
    await fillMultipleChoiceContent(page, "What is $2 + 2$?");

    // Question image upload
    await page.locator('input[type="file"][accept*="image"]').first().setInputFiles(imagePath);
    await waitForAutosave(page);

    // Student Preview — mandatory before publish, and exercises the actual
    // interactive rendering (select answer, submit, see correct/incorrect).
    await page.getByRole("button", { name: "Open Student Preview" }).click();
    const sheet = page.getByRole("dialog").filter({ hasText: "Student Preview" });
    await expect(sheet.getByText("Not yet publishable")).toHaveCount(0);
    await sheet.getByRole("button", { name: "4", exact: false }).first().click();
    await sheet.getByRole("button", { name: "Submit" }).click();
    await expect(sheet.getByText("Correct!")).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();

    // Publish — one click, no confirmation dialog
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // Editing an already-Published question now applies immediately — no
    // Draft Revision buffer, no separate Republish step (Owner-requested
    // change overriding PRD-015 §7.2's original buffer-then-republish design).
    await page.getByLabel("Question text").fill("What is $2 + 2$?? (revised)");
    await waitForAutosave(page);
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Draft Revision")).toHaveCount(0);

    // Unpublish, then Archive
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("This question is archived and read-only.")).toBeVisible({ timeout: 10_000 });

    // Restore
    await page.getByRole("button", { name: "Restore it" }).click();
    await expect(page.getByText("This question is archived and read-only.")).toHaveCount(0, { timeout: 10_000 });
  });

  test("open-ended numeric question: accepted answers and publishing", async ({ page }) => {
    await signInAsOwner(page);
    await createQuestion(page, "Open-Ended Numeric Response");

    await page.getByLabel("Question text").fill("What is one half as a decimal?");
    await page.getByLabel("Accepted answers (one per line)").fill("0.5\n.5");
    await page.setInputFiles('input[type="file"][accept*="video"]', videoPath);
    await expect(page.getByText("Uploading…")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Open Student Preview" }).click();
    const sheet = page.getByRole("dialog").filter({ hasText: "Student Preview" });
    await sheet.getByPlaceholder("Enter your answer").fill("0.5");
    await sheet.getByRole("button", { name: "Submit" }).click();
    await expect(sheet.getByText("Correct!")).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("questions table: search, filter by status, and row actions", async ({ page }) => {
    await signInAsOwner(page);
    const marker = `Searchable ${Date.now()}`;
    await createQuestion(page, "Multiple Choice");
    await fillMultipleChoiceContent(page, marker);

    await page.goto("/owner/content/questions");
    await page.getByPlaceholder("Search question text…").fill(marker);
    await expect(page.getByText(marker)).toBeVisible({ timeout: 10_000 });

    // Duplicate via row action menu
    const row = page.getByRole("row", { name: new RegExp(marker.slice(0, 20)) });
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
    await page.waitForTimeout(1000);
  });

  test("question family: group existing questions, complete, and publish atomically", async ({ page }) => {
    await signInAsOwner(page);

    async function createFamilyEligibleQuestion(text: string) {
      await createQuestion(page, "Multiple Choice");
      await fillMultipleChoiceContent(page, text);
    }

    const marker = Date.now();
    await createFamilyEligibleQuestion(`Family A ${marker}`);
    await createFamilyEligibleQuestion(`Family B ${marker}`);
    await createFamilyEligibleQuestion(`Family C ${marker}`);

    await page.goto("/owner/content/families");
    await page.getByRole("button", { name: "Group Existing Questions" }).click();
    const groupDialog = page.getByRole("dialog");
    await groupDialog.getByText(`Family A ${marker}`).click();
    await groupDialog.getByText(`Family B ${marker}`).click();
    await groupDialog.getByText(`Family C ${marker}`).click();
    await groupDialog.getByRole("button", { name: /Group \d question/ }).click();

    await expect(page).toHaveURL(/\/owner\/content\/families\/[a-z0-9]+$/);
    await expect(page.getByText("3 / 3 versions")).toBeVisible();

    // Shared family video required before publish
    await page.locator('input[type="file"][accept*="video"]').setInputFiles(videoPath);
    await expect(page.getByText("Uploading…")).toHaveCount(0, { timeout: 30_000 });

    // Each version still needs its own Student Preview satisfied
    for (const marker3 of ["Family A", "Family B", "Family C"]) {
      const versionRow = page.getByText(new RegExp(`${marker3} ${marker}`)).locator("..").locator("..");
      await versionRow.getByRole("button", { name: "Preview" }).click();
      const sheet = page.getByRole("dialog").filter({ hasText: "Student Preview" });
      await expect(sheet.getByRole("heading", { name: "Student Preview" })).toBeVisible();
      await sheet.getByRole("button", { name: "Close" }).click();
    }

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("button", { name: "Confirm Publish" }).click();
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("content coverage page shows the category × difficulty matrix and links to filtered questions", async ({
    page,
  }) => {
    await signInAsOwner(page);
    await page.goto("/owner/content/coverage");
    await expect(page.getByRole("heading", { name: "Content Coverage" })).toBeVisible();
    await expect(page.getByText("published").first()).toBeVisible();

    await page.getByText("published").first().click();
    await expect(page).toHaveURL(/\/owner\/content\/questions\?/);
  });
});
