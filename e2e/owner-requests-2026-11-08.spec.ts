import "dotenv/config";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { uniqueEmail, signUpNewStudent } from "./helpers";

/**
 * The Owner's requests of 2026-11-08, in a real browser: the class "Add students" panel and the
 * always-visible student Homework join, the pinned "Assign to class" button, both Guided Session
 * modes with the per-student report, and the district administrator.
 */

const SHOTS = process.env.E2E_SHOTS_DIR ?? path.join(process.cwd(), "test-results", "owner-shots");
mkdirSync(SHOTS, { recursive: true });
const DESKTOP = { width: 1440, height: 900 };
const PASSWORD = "teacherpass123";

async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: path.join(SHOTS, name), fullPage });
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: DESKTOP, permissions: ["clipboard-read", "clipboard-write"] });
  return context.newPage();
}

type Seeded = { id: string; email: string };

/** Seeds through a tsx child process: Playwright's loader can't import the generated Prisma client. */
function seed<T>(op: string, arg: Record<string, unknown> = {}): T {
  const out = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "e2e/fixtures/owner-requests-seed.ts", op, JSON.stringify(arg)], {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
  return JSON.parse(out.trim().split(/\r?\n/).pop()!) as T;
}

function seedTeacher() {
  const r = seed<{ school: { id: string; officialName: string }; teacher: Seeded }>("teacher");
  return r;
}

function seedClass(teacherId: string, schoolId: string, name: string) {
  return seed<{ id: string; joinCode: string }>("class", { teacherId, schoolId, name });
}

async function logIn(page: Page, email: string, password: string, landing: RegExp = /\/(home|teacher|admin)/) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(landing, { timeout: 30_000 });
}

async function studentJoinsClass(page: Page, joinCode: string, lastName: string) {
  await page.goto("/home");
  // The Homework nav item is always visible, even before the student has a class.
  await page.getByRole("link", { name: "Homework" }).first().click();
  await expect(page).toHaveURL(/\/homework/);
  await page.getByLabel("Class code").fill(joinCode);
  await page.getByLabel("Your last name").fill(lastName);
  await page.getByRole("button", { name: "Join class" }).click();
  await expect(page).toHaveURL(/\/homework\?joined=1/, { timeout: 30_000 });
}

async function newStudentInClass(browser: Browser, joinCode: string, lastName: string) {
  const page = await newPage(browser);
  await signUpNewStudent(page, { email: uniqueEmail(), password: "hunter2222", grade: "11th" });
  await studentJoinsClass(page, joinCode, lastName);
  return page;
}

/** Joins a Guided Session by typing its code at /live, then pressing Join. */
async function joinSessionByCode(page: Page, sessionCode: string) {
  await page.goto("/live");
  await page.getByLabel("The six-character code on the board").fill(sessionCode);
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page).toHaveURL(/\/live\/[a-z0-9]+/, { timeout: 30_000 });
  await page.getByRole("button", { name: /^Join$/ }).click();
}

async function openSession(teacher: Page, classId: string, mode: "TEACHER_LED" | "INDIVIDUAL") {
  await teacher.goto(`/teacher/classes/${classId}/live/new`);
  if (mode === "INDIVIDUAL") await teacher.getByRole("radio", { name: /Individual practice/ }).check();
  // With no Diagnostic data nothing is pre-chosen; make sure a skill is.
  const skills = teacher.locator("fieldset", { has: teacher.locator('input[name="category"]') }).first();
  if ((await skills.locator('input[name="category"]:checked').count()) === 0) {
    await skills.locator('input[name="category"]').first().check();
  }
  await teacher.getByRole("button", { name: "Open the session" }).click();
  await expect(teacher).toHaveURL(/\/teacher\/live\/[a-z0-9]+$/, { timeout: 30_000 });
  const sessionId = teacher.url().split("/").pop()!;
  const sessionCode = (await teacher.getByText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/).first().textContent())!.trim();
  return { sessionId, sessionCode };
}

/** Picks any choice (or types 1 for a grid-in) on the question on screen. */
async function chooseAnyAnswer(page: Page) {
  const control = page.locator('[data-answer-choice], input[aria-label="Your answer"]').first();
  await expect(control).toBeVisible({ timeout: 30_000 });
  if ((await control.getAttribute("data-answer-choice")) !== null) await control.click();
  else await control.fill("1");
}

/** The warm-up is on screen: choose any answer, send it, and wait until it is recorded. */
async function answerFirstClassQuestion(page: Page) {
  await chooseAnyAnswer(page);
  await page.getByRole("button", { name: /^Submit$/ }).click();
  await expect(page.getByText(/^Answer sent/)).toBeVisible({ timeout: 30_000 });
}

/** On their own questions: wait for the own-question screen, answer once and wait for the feedback. */
async function answerOwnUntilSubmitted(page: Page) {
  await expect(page.getByText(/^Question \d+ of \d+$/)).toBeVisible({ timeout: 30_000 });
  await chooseAnyAnswer(page);
  await page.getByRole("button", { name: /^Submit$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: /^(Correct\.|The answer is)/ })).toBeVisible({ timeout: 30_000 });
}

test.describe("Owner requests of 2026-11-08", () => {
  test.setTimeout(240_000);

  test("1. a new class asks for students: code panel, show-to-class, student joins from Homework", async ({ browser }) => {
    const { teacher } = seedTeacher();
    const tp = await newPage(browser);
    await logIn(tp, teacher.email, PASSWORD);
    await tp.goto("/teacher");
    await tp.getByLabel("Class name").fill("E2E Period 3");
    await tp.getByRole("button", { name: "Create class" }).click();
    await expect(tp).toHaveURL(/\/teacher\/classes\/[a-z0-9]+\?new=1$/, { timeout: 30_000 });
    await expect(tp.getByRole("heading", { name: /E2E Period 3 is ready\. Now add your students\./ })).toBeVisible();

    const panel = tp.locator("section[aria-labelledby=add-students-heading]");
    const code = (await panel.getByText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/).first().textContent())!.trim();
    await shot(tp, "class-add-students.png");

    await panel.getByRole("button", { name: "Copy code" }).click();
    await expect(tp.getByText("Code copied").first()).toBeVisible();
    expect((await tp.evaluate(() => navigator.clipboard.readText())).replace("-", "")).toBe(code.replace("-", ""));

    await tp.getByRole("button", { name: "Show code to class" }).click();
    const dialog = tp.getByRole("dialog", { name: "Class code for your students" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(code)).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await tp.getByRole("button", { name: "Show code to class" }).click();
    await expect(dialog).toBeVisible();
    await tp.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    const student = await newPage(browser);
    await signUpNewStudent(student, { email: uniqueEmail(), password: "hunter2222", grade: "11th" });
    await studentJoinsClass(student, code, "Lovelace");
    await expect(student.getByText("Ms. Rivera")).toBeVisible();

    await tp.reload();
    await expect(tp.getByText(/Lovelace/).first()).toBeVisible();
  });

  test("2. assign-homework: the Assign button stays on screen when the panel overflows", async ({ browser }) => {
    const { teacher, school } = seedTeacher();
    const cls = seedClass(teacher.id, school.id, "E2E Homework Class");
    const tp = await newPage(browser);
    await logIn(tp, teacher.email, PASSWORD);
    await tp.goto(`/teacher/classes/${cls.id}/assignments/new`);
    await tp.getByLabel("Title").fill("E2E long homework");
    for (let i = 0; i < 3; i++) await tp.getByRole("button", { name: "Add 10 at random" }).click();
    await expect(tp.getByText(/Questions\s*·\s*\d+\/30/)).toBeVisible();

    const assign = tp.getByRole("button", { name: "Assign to class" });
    await expect(assign).toBeVisible();
    const box = (await assign.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(DESKTOP.height);
    const overflow = await tp.locator("#this-homework > div").first().evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(overflow).toBe(true);
    await tp.mouse.wheel(0, 1500);
    const box2 = (await assign.boundingBox())!;
    expect(box2.y + box2.height).toBeLessThanOrEqual(DESKTOP.height);
    await tp.evaluate(() => window.scrollTo(0, 0));
    await shot(tp, "homework-builder.png");

    await assign.click();
    await expect(tp).toHaveURL(/\/assignments\/[a-z0-9]+$/, { timeout: 30_000 });
  });

  test("3. Guided Session, teacher-led: script, student screens, per-student report, CSV", async ({ browser }) => {
    const { teacher, school } = seedTeacher();
    const cls = seedClass(teacher.id, school.id, "E2E Guided Class");
    const student = await newStudentInClass(browser, cls.joinCode, "Lovelace");
    const tp = await newPage(browser);
    await logIn(tp, teacher.email, PASSWORD);

    const { sessionId, sessionCode } = await openSession(tp, cls.id, "TEACHER_LED");
    await expect(tp.getByText("What to do")).toBeVisible({ timeout: 30_000 });
    await expect(tp.getByText("What to say")).toBeVisible();
    await expect(tp.getByRole("heading", { name: "On students' screens" })).toBeVisible();
    await shot(tp, "console-teacher-led.png");

    await joinSessionByCode(student, sessionCode);
    await expect(tp.getByText(/1 of 1 here/)).toBeVisible({ timeout: 30_000 });
    // The warm-up is open while students join: answer it, then the teacher starts.
    await answerFirstClassQuestion(student);
    await shot(student, "student-teacher-led.png");
    await expect(tp.getByText(/1 answered/)).toBeVisible({ timeout: 30_000 });
    await tp.getByRole("button", { name: "Start the session" }).click();

    await tp.getByRole("button", { name: /Skip ahead to the students' own questions/ }).click();
    await answerOwnUntilSubmitted(student);

    await tp.getByRole("button", { name: "End session" }).first().click();
    await tp.getByRole("dialog").getByRole("button", { name: "End the session" }).click();
    await expect(tp).toHaveURL(new RegExp(`/teacher/classes/${cls.id}/live/${sessionId}$`), { timeout: 30_000 });

    await expect(tp.getByRole("heading", { name: "Each student", exact: true })).toBeVisible();
    // The student's own answer is counted: "R of 1 right", then how many weren't reached.
    await expect(tp.getByRole("row", { name: /Lovelace/ }).first()).toContainText(/[01] of 1 right\s*\d+ not reached/);
    await shot(tp, "report-each-student.png", true);
    await tp.getByRole("button", { name: /^Questions/ }).first().click();
    await expect(tp.locator("tr[id^=drill-] table").first()).toBeVisible();
    await shot(tp, "report-drilldown.png", true);

    const base = `/teacher/classes/${cls.id}/live/${sessionId}/export`;
    for (const url of [base, `${base}?detail=questions`]) {
      const res = await tp.request.get(url);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/csv");
      expect(res.headers()["content-disposition"]).toContain("attachment");
      expect(await res.text()).toContain("Lovelace");
    }
  });

  test("4. Guided Session, individual practice: personalized questions, monitor, report", async ({ browser }) => {
    const { teacher, school } = seedTeacher();
    const cls = seedClass(teacher.id, school.id, "E2E Individual Class");
    const s1 = await newStudentInClass(browser, cls.joinCode, "Hopper");
    const s2 = await newStudentInClass(browser, cls.joinCode, "Turing");
    const tp = await newPage(browser);
    await logIn(tp, teacher.email, PASSWORD);

    const { sessionId, sessionCode } = await openSession(tp, cls.id, "INDIVIDUAL");
    await joinSessionByCode(s1, sessionCode);
    await joinSessionByCode(s2, sessionCode);
    for (const s of [s1, s2]) await answerOwnUntilSubmitted(s);
    await shot(s1, "student-individual.png");

    await expect(tp.getByText(/Hopper/).first()).toBeVisible({ timeout: 30_000 });
    await expect(tp.getByText(/Turing/).first()).toBeVisible();
    await expect(tp.getByLabel(/Hopper.*of \d+ answered/)).toBeVisible({ timeout: 30_000 });
    await shot(tp, "monitor-individual.png");

    await tp.getByRole("button", { name: "End session" }).first().click();
    await tp.getByRole("dialog").getByRole("button", { name: "End the session" }).click();
    await expect(tp).toHaveURL(new RegExp(`/teacher/classes/${cls.id}/live/${sessionId}$`), { timeout: 30_000 });
    await expect(tp.getByRole("heading", { name: "Each student", exact: true })).toBeVisible();
    await expect(tp.getByRole("row", { name: /Hopper/ })).toContainText(/\d of 1 right\s*9 not reached/);
    await expect(tp.getByRole("row", { name: /Turing/ })).toBeVisible();
  });

  test("5. district administrator: overview by campus, open a campus, publish there", async ({ browser }) => {
    const { district, north, south, admin } = seed<{
      district: { officialName: string };
      north: { id: string; officialName: string };
      south: { id: string; officialName: string };
      admin: Seeded;
    }>("district");

    const ap = await newPage(browser);
    await logIn(ap, admin.email, PASSWORD);
    await ap.goto("/admin");
    await expect(ap.getByRole("heading", { name: district.officialName })).toBeVisible();
    const table = ap.getByRole("table", { name: "PrepHub activity by campus" });
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(table.getByRole("link", { name: north.officialName })).toBeVisible();
    await expect(table.getByRole("link", { name: south.officialName })).toBeVisible();
    // Activity counts are shown exactly since 2026-11-09 (campus pages show them); readiness has its own column.
    await expect(table.getByRole("columnheader", { name: /Meet TSI now/ })).toBeVisible();
    await shot(ap, "admin-district.png", true);

    await table.getByRole("link", { name: north.officialName }).click();
    await expect(ap).toHaveURL(new RegExp(`/admin\\?school=${north.id}`));
    await expect(ap.getByText(north.officialName).first()).toBeVisible();

    await ap.goto(`/admin/announcements?school=${north.id}`);
    await ap.getByLabel("Title").fill("District hello");
    await ap.getByLabel("Message").fill("Practice this week, North campus.");
    await ap.getByRole("button", { name: "Preview before sending" }).click();
    await ap.getByRole("button", { name: /^Send to \d+ students?$/ }).click();
    await expect(ap.getByRole("heading", { name: "Showing to students now" })).toBeVisible({ timeout: 30_000 });

    // With no campus chosen, a district administrator writes to every campus at once (2026-11-09).
    await ap.goto("/admin/announcements");
    await expect(ap.getByRole("heading", { name: "Announcements to every campus" })).toBeVisible();

    const foreign = seed<{ id: string; officialName: string }>("school", { name: `E2E Foreign ${Date.now()}` });
    await ap.goto(`/admin?school=${foreign.id}`);
    await expect(ap.getByText(foreign.officialName)).toHaveCount(0);
  });
});
