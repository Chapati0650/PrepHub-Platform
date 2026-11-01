import { test, expect, type Page } from "@playwright/test";
import { uniqueEmail, signUpNewStudent, signInAsOwner, todayPlusDays, getLatestEmailTo } from "./helpers";

/**
 * A teacher's whole loop (2026-10-31): added by the Owner, sets a password
 * from the invite, names themselves for students, makes a class, a student
 * joins with a last name, the teacher assigns a quiz, the student is emailed,
 * sees it on their dashboard and does it without being told right or wrong,
 * and the teacher sees the result by name and can download the gradebook.
 * Since 2026-11-01 also: the teacher reminds the student who hasn't started
 * (once — the second reminder waits a day), and assigns the same quiz to a
 * second class from its results page.
 */
test.describe("Teachers, classes and homework", () => {
  test("a quiz from assignment to results", async ({ page, browser }) => {
    test.setTimeout(240_000);

    // ---- Owner: an active school with one teacher.
    await signInAsOwner(page);
    await page.goto("/owner/schools");
    const dialog = page.getByRole("dialog");
    await page.getByRole("button", { name: "Create Organization" }).click();
    await page.getByLabel("Official name").fill(`E2E Teacher School ${Date.now()}`);
    await page.getByLabel("City").fill("Testville");
    await page.getByLabel("State").fill("TX");
    await page.getByLabel("School year").fill("2026-2027");
    await page.locator("#contractStartDate").fill(todayPlusDays(-1));
    await page.locator("#contractEndDate").fill(todayPlusDays(365));
    await dialog.getByRole("button", { name: "Create Organization" }).click();
    // Generous waits on navigations: the dev server compiles each page the first time it's opened.
    await expect(page).toHaveURL(/\/owner\/schools\/[a-z0-9]+$/, { timeout: 30_000 });
    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();

    const teacherEmail = uniqueEmail();
    await page.getByLabel("Teacher's first name").fill("Rosa");
    await page.getByLabel("Teacher's school email").fill(teacherEmail);
    await page.getByRole("button", { name: "Add teacher" }).click();
    await expect(page.getByText(teacherEmail)).toBeVisible();

    // ---- Teacher: password from the invite, then a name and a class.
    const teacher = await (await browser.newContext()).newPage();
    const invite = await getLatestEmailTo(teacherEmail);
    const link = /\/reset-password\/[A-Za-z0-9_-]+/.exec(invite.text)?.[0];
    expect(link).toBeTruthy();
    await teacher.goto(link!);
    await teacher.getByLabel("Password").fill("teacherpass123");
    await teacher.getByRole("button", { name: "Set password" }).click();
    await expect(teacher).toHaveURL(/\/login/, { timeout: 30_000 });
    await teacher.getByLabel("Email").fill(teacherEmail);
    await teacher.getByLabel("Password").fill("teacherpass123");
    await teacher.getByRole("button", { name: "Log in", exact: true }).click();
    await teacher.waitForURL(/\/(home|teacher)/);
    await teacher.goto("/teacher");

    await teacher.getByLabel("Your name for students").fill("Ms. Rivera");
    await teacher.getByRole("button", { name: "Save", exact: true }).click();
    await expect(teacher.getByText("Saved.")).toBeVisible();

    await teacher.getByLabel("Class name").fill("E2E Period 1");
    await teacher.getByRole("button", { name: "Create class" }).click();
    await expect(teacher).toHaveURL(/\/teacher\/classes\/[a-z0-9]+$/, { timeout: 30_000 });
    const classUrl = teacher.url();
    const code = (await teacher.getByText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/).first().textContent())!.trim();

    // ---- Student: joins with a last name.
    const student = await (await browser.newContext()).newPage();
    const studentEmail = uniqueEmail();
    await signUpNewStudent(student, { email: studentEmail, password: "hunter2222", grade: "11th" });
    await student.goto("/homework");
    await student.getByLabel("Class code").fill(code);
    await student.getByLabel("Your last name").fill("Lovelace");
    await student.getByRole("button", { name: "Join class" }).click();
    await expect(student).toHaveURL(/\/homework\?joined=1/, { timeout: 30_000 });
    await expect(student.getByText("Ms. Rivera")).toBeVisible();

    // ---- Teacher: a five-question quiz.
    await teacher.goto(`${classUrl}/assignments/new`);
    await teacher.getByRole("button", { name: "Add 5 at random" }).click();
    await expect(teacher.getByText(/Questions\s*·\s*5\/30/)).toBeVisible();
    await teacher.getByLabel("Title").fill("E2E quiz");
    await teacher.getByRole("radio", { name: /Quiz/ }).check();
    await teacher.getByRole("button", { name: "Assign to class" }).click();
    await expect(teacher).toHaveURL(/\/assignments\/[a-z0-9]+$/, { timeout: 30_000 });
    await expect(teacher.getByText("Quiz · answers shown when turned in")).toBeVisible();
    const assignmentUrl = teacher.url();

    // ---- Student: emailed, reminded on the dashboard, and never told right or wrong.
    const email = await getLatestEmailTo(studentEmail);
    expect(email.subject).toBe("New homework from Ms. Rivera: E2E quiz");

    // ---- Teacher: chases the one student who hasn't started, once.
    await teacher.getByRole("button", { name: "Remind the 1 who hasn't finished" }).click();
    await teacher.getByRole("dialog").getByRole("button", { name: "Send reminder" }).click();
    await expect(teacher.getByText("Reminder sent to 1 student.")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await getLatestEmailTo(studentEmail)).subject).toBe("Reminder from Ms. Rivera: E2E quiz");
    await teacher.reload();
    await expect(teacher.getByText(/You can send the next one after/)).toBeVisible();
    await expect(teacher.getByRole("button", { name: /^Remind the/ })).toHaveCount(0);
    await student.goto("/home");
    await expect(student.getByText("Homework to do")).toBeVisible();
    await student.getByText("Homework to do").click();
    await student.getByRole("button", { name: "Start" }).click();
    await expect(student).toHaveURL(/\/homework\/session\//, { timeout: 30_000 });
    for (let i = 0; i < 5; i++) await answerQuizQuestion(student, i === 4);
    await expect(student).toHaveURL(/\/homework\/results\//, { timeout: 30_000 });
    await expect(student.getByText(/\/5$/).first()).toBeVisible();

    // ---- Teacher: the result, by the student's full name, and the gradebook.
    await teacher.reload();
    const row = teacher.getByRole("row", { name: /Lovelace, Ada/ });
    await expect(row.getByText("Finished")).toBeVisible();
    await expect(teacher.getByText("(right)").first()).toBeVisible();
    const csv = await teacher.request.get(`${classUrl}/export`);
    expect(csv.status()).toBe(200);
    const csvText = await csv.text();
    expect(csvText).toContain("Lovelace,Ada");
    expect(csvText).toContain("Turned in late");

    // ---- Teacher: the same quiz for a second class, from the results page.
    await teacher.goto("/teacher");
    await teacher.getByLabel("Class name").fill("E2E Period 2");
    await teacher.getByRole("button", { name: "Create class" }).click();
    await expect(teacher).toHaveURL(/\/teacher\/classes\/[a-z0-9]+$/, { timeout: 30_000 });
    await teacher.goto(assignmentUrl);
    await teacher.getByRole("checkbox", { name: "E2E Period 2" }).check();
    await teacher.getByRole("button", { name: "Assign to class" }).click();
    const copy = teacher.getByRole("link", { name: "Open E2E Period 2's copy" });
    await expect(copy).toBeVisible({ timeout: 30_000 });
    await copy.click();
    await expect(teacher).not.toHaveURL(assignmentUrl, { timeout: 30_000 });
    await expect(teacher.getByRole("heading", { name: "E2E quiz" })).toBeVisible();
    await expect(teacher.getByText("Quiz · answers shown when turned in")).toBeVisible();
    await expect(teacher.getByText("E2E Period 2").first()).toBeVisible();
  });
});

/** Answers the question on screen (any choice, or "1" for a grid-in) and moves on. */
async function answerQuizQuestion(page: Page, last: boolean) {
  // Wait for the question itself, whichever kind it is, before choosing how to answer.
  const control = page.locator('[data-answer-choice], input[aria-label="Your answer"]').first();
  await expect(control).toBeVisible({ timeout: 30_000 });
  if ((await control.getAttribute("data-answer-choice")) !== null) {
    await control.click();
  } else {
    await control.fill("1");
  }
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByText("Answer saved.")).toBeVisible();
  await expect(page.getByText(/^(Correct!|Incorrect\.)$/)).toHaveCount(0);
  if (last) {
    await page.getByRole("button", { name: "Turn in homework" }).first().click();
  } else {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
}
