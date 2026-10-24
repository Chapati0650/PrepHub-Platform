import { test, expect, type Page } from "@playwright/test";
import { uniqueEmail, signUpNewStudent, payWithTestCard } from "./helpers";

// Answers every question in the current runner by always picking the first
// answer choice — content correctness doesn't matter for these flows, only
// that every question gets submitted and finalized. The published question
// bank mixes this run's seeded content with whatever other e2e specs have
// published in the shared dev DB, so choice text can't be assumed uniform;
// `data-answer-choice` is a content-agnostic hook on each choice. (This used
// to select `button[aria-pressed]`, which since the Bluebook redesign also
// matches Mark for Review and the cross-out buttons — and a tap used to
// submit, where now a choice is only a draft until Submit.)
async function answerAllQuestions(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    const choiceButtons = page.locator("[data-answer-choice]");
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

    // From the dashboard's card to the Diagnostic's single intro screen
    // (2026-09-21: the six informational screens and the access chooser are
    // gone from the path).
    await page.getByRole("link", { name: "Begin Diagnostic" }).click();
    await expect(page).toHaveURL(/\/diagnostic$/);
    await expect(page.getByText("Talent may affect where you begin.")).toBeVisible();
    await page.getByRole("button", { name: "Begin Diagnostic" }).click();

    // The staged Diagnostic (src/lib/diagnostic/sequence.ts): fourteen core
    // questions, then a bonus round holding the Hard question for each
    // category whose Medium was answered right. Answers here are arbitrary, so
    // the bonus round may have anywhere from zero to seven questions — or not
    // appear at all — and the test follows whichever happened.
    await expect(page.getByText("Question 1 of 14")).toBeVisible();
    await answerAllQuestions(page, 14);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/diagnostic(\/results|\?round=unlocked)$/);
    if (page.url().includes("round=unlocked")) {
      await expect(page.getByRole("heading", { name: /You unlocked/ })).toBeVisible();
      await page.getByRole("link", { name: "Start the bonus round" }).click();
      const pill = await page.getByText(/^Bonus question 1 of \d+$/).textContent();
      const bonusCount = Number(pill?.match(/of (\d+)/)?.[1]);
      await answerAllQuestions(page, bonusCount);
      await page.getByRole("button", { name: "See my results" }).click();
    }

    // Diagnostic results (PRD-007's shared Session Review experience). Same
    // first-compile allowance as the practice results below.
    await expect(page).toHaveURL(/\/diagnostic\/results$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Diagnostic Complete" })).toBeVisible();
    await expect(page.getByText("Your Initial PrepHub Score Prediction")).toBeVisible();
    await expect(page.getByText(/^\d{3,4}–\d{3,4}$/)).toBeVisible();

    // The results carry the one-sentence analysis.
    await expect(page.getByText(/losing the most points|close to even/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Start your free practice set" })).toBeVisible();

    // The dashboard shows the diagnostic-completed state.
    await page.goto("/home");
    // The greeting is time-of-day ("Good evening, Ada.") and decided on the
    // client after hydration, so only the name is stable to assert on.
    await expect(page.getByRole("heading", { name: /, Ada\.$/ })).toBeVisible();
    await expect(page.getByText("PrepHub Score Prediction")).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue Practice" })).toBeVisible();

    // Set 1 is free (lib/practice/free-tier.ts): the pre-generated first
    // set opens without a subscription.
    await page.getByRole("link", { name: "Continue Practice" }).click();
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page.getByRole("heading", { name: "Practice Set 1" })).toBeVisible();
    await expect(page.getByText("21 Questions")).toBeVisible();
    await expect(page.getByText("Free · personalized from your Diagnostic.")).toBeVisible();
    await page.getByRole("link", { name: "Start Practice" }).click();

    // 21-question adaptive practice set.
    await expect(page).toHaveURL(/\/practice\/session$/);
    await expect(page.getByText("Question 1 of 21")).toBeVisible();
    await answerAllQuestions(page, 21);
    await page.getByRole("button", { name: "Finish", exact: true }).click();

    // Session Review & Results (PRD-007) for the completed set. A generous
    // timeout because the first visit to a route compiles it on the dev
    // server — measured at 3.8s here, on top of the completion action itself.
    await expect(page).toHaveURL(/\/practice\/results\/[a-z0-9]+$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Session Complete" })).toBeVisible();
    await expect(page.getByText("Your Updated PrepHub Score Prediction")).toBeVisible();
    await expect(page.getByText("Mastery by Category")).toBeVisible();
    await expect(page.getByText("Correct", { exact: true }).first()).toBeVisible();

    // Expand one question's detailed review.
    await page.getByRole("button", { name: /Question 1\b/ }).click();
    await expect(page.getByText("is correct because this is seeded practice content.")).toBeVisible();

    // Continue Practice returns to the Practice page (PRD-005 §24), not
    // directly into a question — and Set 2 is where Premium starts.
    await page.getByRole("link", { name: "Continue Practice" }).click();
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page.getByRole("heading", { name: "Your next set is ready." })).toBeVisible();
    await expect(page.getByText(/prediction/)).toBeVisible();

    // Subscribe via a real Stripe test-mode checkout.
    await page.getByRole("link", { name: "Unlock every set" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await page.getByRole("button", { name: "Subscribe Monthly" }).click();
    await payWithTestCard(page, email);

    // The pre-generated Set 2 opens without regenerating.
    await page.goto("/practice");
    await expect(page.getByRole("heading", { name: "Practice Set 2" })).toBeVisible();
    await expect(page.getByText("Personalized from your performance.")).toBeVisible();

    // Progress page reflects the completed diagnostic + one adaptive session.
    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "Your Progress" })).toBeVisible();
    await expect(page.getByText("Diagnostic")).toBeVisible();
    await expect(page.getByText("Set 1")).toBeVisible();
  });
});
