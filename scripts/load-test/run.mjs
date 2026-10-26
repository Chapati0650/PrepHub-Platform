/**
 * The load test: a school's first bell, then a class period.
 *
 *   node scripts/load-test/run.mjs --base=https://<deploy-preview>.netlify.app --password=<as seeded> \
 *     [--students=2000] [--concurrency=200] [--rounds=2] [--browsers=20] [--answers=10]
 *
 * Point it at a deploy preview whose DATABASE_URL is a Neon branch seeded by
 * `scripts/load-test/seed.ts`. It refuses prephubtp.com: a load test against
 * production is an outage you caused yourself.
 *
 * 1. Sign-in burst — every student signs in at once (at `--concurrency`),
 *    through Auth.js's own credentials endpoint.
 * 2. Page loads — each signed-in student loads the student pages
 *    `--rounds` times, while an administrator loads the school-wide pages.
 * 3. At the same time, `--browsers` real browsers each answer `--answers`
 *    Diagnostic questions, which is the write path (server actions and
 *    transactions) a plain HTTP client can't drive.
 *
 * Prints the median and slow-tail response times per page and every error,
 * and exits non-zero if more than 1% of requests failed. Needs no
 * dependencies beyond the repo's own Playwright.
 */
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const BASE = (args.base ?? "").replace(/\/+$/, "");
const PASSWORD = args.password ?? "";
const STUDENTS = Number(args.students ?? 2000);
const CONCURRENCY = Number(args.concurrency ?? 200);
const ROUNDS = Number(args.rounds ?? 2);
const BROWSERS = Number(args.browsers ?? 20);
const ANSWERS = Number(args.answers ?? 10);
const DOMAIN = "loadtest.example.com";
const STUDENT_PAGES = ["/home", "/practice", "/diagnostic", "/community", "/rush", "/daily", "/progress"];
const ADMIN_PAGES = ["/admin", "/admin/students", "/community"];

if (!BASE || !PASSWORD) {
  console.error("Usage: node scripts/load-test/run.mjs --base=<preview URL> --password=<as seeded> [options]");
  process.exit(2);
}
if (/(^|\.)prephubtp\.com$/i.test(new URL(BASE).hostname)) {
  console.error("Refusing to load-test production. Use a deploy preview pointed at the load-test branch.");
  process.exit(2);
}

const email = (n) => `lt-${String(n).padStart(5, "0")}@${DOMAIN}`;

// ---- Measurements ------------------------------------------------------------
const samples = new Map(); // label -> { ms: number[], errors: Map<string, number> }
function record(label, ms, failure) {
  if (!samples.has(label)) samples.set(label, { ms: [], errors: new Map() });
  const s = samples.get(label);
  s.ms.push(ms);
  if (failure) s.errors.set(failure, (s.errors.get(failure) ?? 0) + 1);
}
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function pool(items, size, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

// ---- HTTP client ---------------------------------------------------------------
function cookieJar() {
  const jar = new Map();
  return {
    absorb(res) {
      for (const c of res.headers.getSetCookie()) {
        const pair = c.split(";")[0];
        const i = pair.indexOf("=");
        jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
      }
    },
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    signedIn: () => [...jar.keys()].some((k) => k.includes("session-token")),
  };
}

async function signIn(address, label = "sign in") {
  const jar = cookieJar();
  const started = performance.now();
  try {
    const csrf = await fetch(`${BASE}/api/auth/csrf`);
    jar.absorb(csrf);
    const { csrfToken } = await csrf.json();
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
      body: new URLSearchParams({ csrfToken, email: address, password: PASSWORD, callbackUrl: `${BASE}/home` }),
    });
    jar.absorb(res);
    record(label, performance.now() - started, jar.signedIn() ? null : `no session (${res.status})`);
    return jar.signedIn() ? jar : null;
  } catch (err) {
    record(label, performance.now() - started, err.cause?.code ?? err.name);
    return null;
  }
}

async function load(jar, path) {
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: jar.header() }, redirect: "manual" });
    await res.arrayBuffer(); // the whole streamed page, not just its headers
    record(`GET ${path}`, performance.now() - started, res.status >= 500 ? `HTTP ${res.status}` : null);
  } catch (err) {
    record(`GET ${path}`, performance.now() - started, err.cause?.code ?? err.name);
  }
}

// ---- Real browsers answering the Diagnostic -----------------------------------
async function diagnosticBrowsers(firstStudent) {
  if (BROWSERS === 0) return;
  const browser = await chromium.launch();
  await Promise.all(
    Array.from({ length: BROWSERS }, async (_, i) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      let stage = "sign in";
      try {
        await page.goto(`${BASE}/login`);
        await page.getByLabel("Email").fill(email(firstStudent + i));
        await page.getByLabel("Password").fill(PASSWORD);
        await page.getByRole("button", { name: "Log in", exact: true }).click();
        await page.waitForURL(/\/home$/, { timeout: 60_000 });
        stage = "open the Diagnostic";
        await page.goto(`${BASE}/diagnostic`);
        await page.getByRole("link", { name: /Begin|Start/ }).or(page.getByRole("button", { name: /Begin|Start/ })).first().click();
        for (let q = 0; q < ANSWERS; q++) {
          stage = `question ${q + 1}`;
          await page.waitForSelector("[data-answer-choice], input[aria-label='Your answer']", { timeout: 60_000 });
          const choice = page.locator("[data-answer-choice]").first();
          if (await choice.count()) await choice.click();
          else await page.getByLabel("Your answer").fill("1");
          const started = performance.now();
          await page.getByRole("button", { name: "Submit answer" }).click();
          await page.getByText(/Correct!|Incorrect\./).first().waitFor({ timeout: 60_000 });
          record("answer a Diagnostic question", performance.now() - started, null);
          await page.getByRole("button", { name: "Next" }).click();
        }
      } catch (err) {
        record("answer a Diagnostic question", 0, `browser ${i}, ${stage}: ${String(err.message).split("\n")[0].slice(0, 80)}`);
      } finally {
        await context.close();
      }
    }),
  );
  await browser.close();
}

// ---- The run ---------------------------------------------------------------------
console.log(`Load test against ${BASE}: ${STUDENTS} students, ${CONCURRENCY} at a time, ${ROUNDS} round(s), ${BROWSERS} browser(s).`);
const t0 = performance.now();

// 1. The first bell. The browser students are kept out of this set, so their
//    own sign-in happens in the browser.
const httpStudents = Array.from({ length: Math.max(0, STUDENTS - BROWSERS) }, (_, i) => i + 1);
const jars = [];
await pool(httpStudents, CONCURRENCY, async (n) => {
  const jar = await signIn(email(n));
  if (jar) jars.push(jar);
});
console.log(`  sign-in burst done: ${jars.length} of ${httpStudents.length} signed in (${Math.round((performance.now() - t0) / 1000)}s)`);

// 2 + 3. Pages, the administrator, and the browsers, all at once.
const admin = await signIn(`lt-admin@${DOMAIN}`, "sign in (administrator)");
const visits = [];
for (let r = 0; r < ROUNDS; r++) for (const jar of jars) for (const path of STUDENT_PAGES) visits.push([jar, path]);
await Promise.all([
  pool(visits, CONCURRENCY, ([jar, path]) => load(jar, path)),
  admin
    ? pool(Array.from({ length: 10 * ROUNDS }, (_, i) => ADMIN_PAGES[i % ADMIN_PAGES.length]), 3, (path) => load(admin, path))
    : Promise.resolve(),
  diagnosticBrowsers(STUDENTS - BROWSERS + 1),
]);

// ---- Report ---------------------------------------------------------------------
let total = 0;
let failed = 0;
const rows = [];
for (const [label, s] of samples) {
  const sorted = [...s.ms].sort((a, b) => a - b);
  const errors = [...s.errors.values()].reduce((a, b) => a + b, 0);
  total += s.ms.length;
  failed += errors;
  rows.push({
    request: label,
    count: s.ms.length,
    errors,
    "p50 ms": Math.round(percentile(sorted, 50)),
    "p95 ms": Math.round(percentile(sorted, 95)),
    "p99 ms": Math.round(percentile(sorted, 99)),
    "max ms": Math.round(sorted.at(-1) ?? 0),
  });
}
console.log(`\nFinished in ${Math.round((performance.now() - t0) / 1000)}s.`);
console.table(rows);
for (const [label, s] of samples) for (const [why, n] of s.errors) console.log(`  ${label}: ${n} × ${why}`);
const rate = total ? failed / total : 0;
console.log(`\n${failed} of ${total} requests failed (${(rate * 100).toFixed(2)}%).`);
process.exit(rate > 0.01 ? 1 : 0);
