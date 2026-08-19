import { test, expect, type Page } from "@playwright/test";
import { uniqueEmail, signUpNewStudent, payWithTestCard } from "./helpers";

// Answers every question in the current diagnostic/practice runner by always
// picking the first answer choice — content correctness doesn't matter for
// these flows, only that all 21 questions get submitted and finalized. The
// published question bank mixes this run's seeded content with whatever
// other e2e specs have published in the shared dev DB, so choice text can't
// be assumed uniform — every MC choice button carries aria-pressed, which
// nothing else on the page does, making it a content-agnostic selector.
async function answerAllQuestions(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    const choiceButtons = page.locator("button[aria-pressed]");
    const numericInput = page.getByLabel("Your answer");
    // .count() doesn't auto-wait, so checking it right after navigating to a
    // question races the next question's render — wait for either the MC
    // choices or the numeric input to actually appear first.
    await choiceButtons.first().or(numericInput).waitFor({ state: "visible" });
    if (await choiceButtons.count()) {
      await choiceButtons.first().click();
    } else {
      // Open-Ended Numeric — content correctness doesn't matter for flow control.
      await numericInput.fill("1");
    }
    await page.getByRole("button", { name: "Submit answer" }).click();
    await expect(page.getByText(/Correct!|Incorrect\./)).toBeVisible();
    if (i < count - 1) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }
  }
}

test.describe("Diagnostic + Practice loop (PRD-012, PRD-005, PRD-006, PRD-007)", () => {
  test("full journey: intro, diagnostic, results, paywall, subscribe, practice set, session review", async ({ page }) => {
    test.setTimeout(180_000);

    const email = uniqueEmail();
    await signUpNewStudent(page, { email, password: "hunter2222", grade: "11th" });

    // PRD-012 §5/§26 — the diagnostic must be reachable before choosing an
    // access method.
    await page.getByRole("link", { name: "Take the Diagnostic First →" }).click();
    await expect(page).toHaveURL(/\/diagnostic$/);

    // Product introduction — the new welcome screen, then all 6 informational screens.
    await page.getByRole("button", { name: "Start Diagnostic" }).click();
    for (let i = 0; i < 6; i++) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }
    await expect(page.getByText("Talent may affect where you begin.")).toBeVisible();
    await page.getByRole("button", { name: "Begin Diagnostic" }).click();

    // 21-question diagnostic.
    await expect(page.getByText("Question 1 of 21")).toBeVisible();
    await answerAllQuestions(page, 21);
    await page.getByRole("button", { name: "Finish Diagnostic" }).click();

    // Diagnostic results (PRD-007's shared Session Review experience).
    await expect(page).toHaveURL(/\/diagnostic\/results$/);
    await expect(page.getByRole("heading", { name: "Diagnostic Complete" })).toBeVisible();
    await expect(page.getByText("Your Initial PrepHub Score Prediction")).toBeVisible();
    await expect(page.getByText(/^\d{3,4}–\d{3,4}$/)).toBeVisible();

    // Resuming the dashboard now shows the diagnostic-completed state.
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Welcome back, Ada" })).toBeVisible();
    await expect(page.getByText("PrepHub Score Prediction")).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue Practice" })).toBeVisible();

    // Practice is gated behind paid access (PRD-005 §5/§26) even though the
    // first adaptive set was already generated in the background.
    await page.getByRole("link", { name: "Continue Practice" }).click();
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page.getByRole("heading", { name: "Your first personalized practice set is ready." })).toBeVisible();
    await expect(page.getByRole("link", { name: "View Plans" })).toBeVisible();

    // Subscribe via a real Stripe test-mode checkout.
    await page.getByRole("link", { name: "View Plans" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await page.getByRole("button", { name: "Subscribe Monthly" }).click();
    await payWithTestCard(page, email);

    // Practice now unlocks the pre-generated first set without regenerating it.
    await page.goto("/practice");
    await expect(page.getByRole("heading", { name: "Practice Set 1" })).toBeVisible();
    await expect(page.getByText("21 Questions")).toBeVisible();
    await expect(page.getByText("Personalized from your performance.")).toBeVisible();
    await page.getByRole("link", { name: "Start Practice" }).click();

    // 21-question adaptive practice set.
    await expect(page).toHaveURL(/\/practice\/session$/);
    await expect(page.getByText("Question 1 of 21")).toBeVisible();
    await answerAllQuestions(page, 21);
    await page.getByRole("button", { name: /^Finish Practice Set 1$/ }).click();

    // Session Review & Results (PRD-007) for the completed set.
    await expect(page).toHaveURL(/\/practice\/results\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: "Session Complete" })).toBeVisible();
    await expect(page.getByText("Your Updated PrepHub Score Prediction")).toBeVisible();
    await expect(page.getByText("Mastery by Category")).toBeVisible();
    await expect(page.getByText("Correct", { exact: true }).first()).toBeVisible();

    // Expand one question's detailed review.
    await page.getByRole("button", { name: /Question 1\b/ }).click();
    await expect(page.getByText("is correct because this is seeded practice content.")).toBeVisible();

    // Continue Practice returns to the Practice page (PRD-005 §24), not
    // directly into a question — the next set is already generated.
    await page.getByRole("link", { name: "Continue Practice" }).click();
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page.getByRole("heading", { name: "Practice Set 2" })).toBeVisible();

    // Progress page reflects the completed diagnostic + one adaptive session.
    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "Your Progress" })).toBeVisible();
    await expect(page.getByText("Diagnostic")).toBeVisible();
    await expect(page.getByText("Set 1")).toBeVisible();
  });
});
