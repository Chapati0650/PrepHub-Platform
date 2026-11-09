/**
 * The Houston ISD demo (Owner request, 2026-11-06; five campuses since 2026-11-08): a
 * district with several campuses and every kind of account a district sees, for the Owner to try and for Houston ISD's
 * CCMR team to be given later.
 *
 *   npx tsx scripts/demo-houston.ts check            reports, writes nothing
 *   DEMO_PASSWORD=... npx tsx scripts/demo-houston.ts create
 *   npx tsx scripts/demo-houston.ts remove           deletes every demo row
 *   npx tsx scripts/demo-houston.ts refresh          rebuilds it as of today, same password
 *
 * Against production: DATABASE_URL="$NEON" (from the gitignored .env.neon).
 *
 * The five logins (password from DEMO_PASSWORD, never stored in the repo):
 *  - hisd.admin@example.com       District Administrator: the whole district, then each campus
 *  - hisd.campusadmin@example.com School Administrator of the second campus only
 *  - hisd.teacher@example.com     Ms. Rivera: two SAT Prep classes, homework,
 *                                 past Guided Sessions, students with extra time
 *  - hisd.student@example.com     Maya, a junior five weeks in: Diagnostic,
 *                                 four Practice Sets and a fifth waiting, homework,
 *                                 two Guided Sessions, Premium through her school
 *  - hisd.newstudent@example.com  Diego, signed up a moment ago: onboarding, the
 *                                 Premium celebration and the Diagnostic are next
 *
 * **Everything is labelled a demo and built to sit inside production without
 * touching anything real**, the same rules as scripts/demo-district.ts:
 *  - The district is "Houston ISD (Demo)" and the campus "Houston ISD Demo High
 *    School": fictional data must never read as Houston's real figures.
 *  - Every address contains example.com, so no mail is ever sent and every
 *    analytics count and lifecycle email excludes these accounts.
 *  - No partner domain, no roster, hidden from the directory, no 1v1 Rush or
 *    Daily Challenge rows (so no real student meets a fictional one).
 *  - The ~180 fictional students and two fictional teachers have no usable
 *    password.
 *
 * Maya's Diagnostic and Practice Sets go through the real engine
 * (lib/diagnostic, lib/adaptive), so every page she can open, past set
 * results included, is exactly what a real student's would be; the engine
 * stamps everything "now", so her history is then spread over the past five
 * weeks. Everyone else is written directly, as demo-district.ts does, plus the
 * skill levels the Guided Session pick reads and four past Guided Sessions.
 */
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import type { ExtraTime, GuidedConfidence, GuidedPace, QuestionCategory, QuestionDifficulty } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";
import { CURRENT_PRIVACY_VERSION, CURRENT_TOS_VERSION } from "../src/lib/legal";
import { progressWithinRange, sectionScoreFromAbility, SCORING_ENGINE_VERSION } from "../src/lib/score/config";
import { roundToStep } from "../src/lib/score/real-test";
import { CORE_SEQUENCE, BONUS_SEQUENCE } from "../src/lib/diagnostic/sequence";
import { startOrResumeDiagnostic } from "../src/lib/diagnostic/start-diagnostic";
import { finalizeDiagnosticAttempt } from "../src/lib/diagnostic/finalize-attempt";
import { advanceDiagnostic } from "../src/lib/diagnostic/stages";
import { finalizeDiagnosticCompletion } from "../src/lib/diagnostic/complete-diagnostic";
import { generatePracticeSet } from "../src/lib/adaptive/generate-practice-set";
import { finalizeAnswer } from "../src/lib/adaptive/finalize-answer";
import { finalizePracticeSetCompletion } from "../src/lib/adaptive/finalize-practice-set-completion";
import { expectedProbability } from "../src/lib/adaptive/ability";
import { questionRating } from "../src/lib/adaptive/config";
import { sampleDifficulty } from "../src/lib/adaptive/difficulty";
import { generateJoinCode } from "../src/lib/teacher/join-code";
import { countAnswers } from "../src/lib/school/student-activity";

const DISTRICT_NAME = "Houston ISD (Demo)";
/**
 * The demo campuses, plainly named as demo campuses. The first holds the
 * teacher and student logins. `students` sums to STUDENT_COUNT; `quiet` pushes
 * a campus's students toward not having started, `lift` shifts their level, so
 * the district's per-campus table has something to show: a busy campus, a
 * quiet one, and a small one whose small groups are withheld.
 */
const CAMPUSES = [
  { name: "Houston ISD Demo \u2013 Central High School", students: 70, enrollment: 96, quiet: 0, lift: 0 },
  { name: "Houston ISD Demo \u2013 Northside High School", students: 55, enrollment: 76, quiet: -0.12, lift: 4 },
  { name: "Houston ISD Demo \u2013 Bayou High School", students: 40, enrollment: 57, quiet: 0.12, lift: -3 },
  { name: "Houston ISD Demo \u2013 Heights Academy", students: 25, enrollment: 36, quiet: 0.25, lift: -5 },
  { name: "Houston ISD Demo \u2013 Eastside Early College", students: 10, enrollment: 14, quiet: 0.4, lift: 1 },
] as const;
const CAMPUS_TEACHERS = [
  [["Marcus", "Mr. Bell", "m.bell", "Algebra II \u00b7 SAT Math"], ["Priya", "Dr. Raman", "p.raman", "English III \u00b7 SAT Reading"]],
  [["Lena", "Ms. Okafor", "l.okafor", "Geometry \u00b7 SAT Math"], ["Tom", "Mr. Nguyen", "t.nguyen", "English II \u00b7 SAT Reading"]],
  [["Grace", "Ms. Whitfield", "g.whitfield", "Algebra I \u00b7 SAT Math"], ["Sam", "Mr. Ortega", "s.ortega", "English IV \u00b7 SAT Reading"]],
  [["Dana", "Ms. Brooks", "d.brooks", "Pre-Calculus \u00b7 SAT Math"]],
  [["Ravi", "Mr. Shah", "r.shah", "English III \u00b7 SAT Reading"]],
] as const;
const FICTION_DOMAIN = "hisd-demo.example.com";
const MARKER = "DEMO DATA — created by scripts/demo-houston.ts. Remove with `npx tsx scripts/demo-houston.ts remove`.";
const ACCOUNTS = {
  admin: "hisd.admin@example.com",
  campusAdmin: "hisd.campusadmin@example.com",
  teacher: "hisd.teacher@example.com",
  student: "hisd.student@example.com",
  newStudent: "hisd.newstudent@example.com",
} as const;
const STUDENT_COUNT = CAMPUSES.reduce((n, c) => n + c.students, 0);

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const NOW = Date.now();
const LAUNCH = NOW - 45 * DAY;

// ---- Deterministic randomness ---------------------------------------------------

let seed = 0x48495344; // "HISD"
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => min + rand() * (max - min);
const int = (min: number, max: number) => Math.floor(between(min, max + 1));
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const chance = (p: number) => rand() < p;
const normal = (mean: number, spread: number) => mean + (rand() + rand() + rand() - 1.5) * spread;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const shuffled = <T,>(items: readonly T[]): T[] => [...items].map((v) => [rand(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

/** A local afternoon hour (Central), so activity lands after school, not at 3am. */
function afternoon(dayStart: number, hour = between(15.5, 21)): number {
  const d = new Date(dayStart);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() + (hour + 6) * HOUR; // CST is UTC-6
}
/** A class-period time on a school day. */
function classTime(daysAgo: number, hour = 10): number {
  return afternoon(schoolDay(NOW - daysAgo * DAY), hour);
}
/** Back to Friday when `ts` falls on a weekend in Central time: classes and due dates are school days
 *  (review, 2026-11-09: a Guided Session dated Sunday, homework due on a Saturday). */
function schoolDay(ts: number): number {
  // The UTC calendar day, because that's the day afternoon() places a time on.
  const dow = new Date(ts).getUTCDay();
  return dow === 6 ? ts - DAY : dow === 0 ? ts - 2 * DAY : ts;
}

const FIRST_NAMES = [
  "Aaliyah", "Adrian", "Alejandro", "Alexis", "Amara", "Andrea", "Angel", "Anthony", "Ariana", "Ashley", "Benjamin",
  "Brianna", "Camila", "Carlos", "Chloe", "Christian", "Daniel", "Destiny", "Diana", "Dylan", "Elijah", "Emily",
  "Emmanuel", "Evelyn", "Fatima", "Gabriel", "Genesis", "Hannah", "Isaac", "Isabella", "Isaiah", "Jada", "Jasmine",
  "Jayden", "Jesus", "Jordan", "Jose", "Joshua", "Julian", "Kayla", "Kevin", "Layla", "Leah", "Liam", "Luis", "Malik",
  "Mariana", "Mateo", "Mia", "Michael", "Naomi", "Nathan", "Nevaeh", "Noah", "Omar", "Priya", "Ryan", "Samantha",
  "Samuel", "Sebastian", "Sofia", "Tiana", "Trinity", "Valeria", "Victoria", "Ximena", "Xavier", "Yasmin", "Zoe",
];
const LAST_NAMES = [
  "Garcia", "Hernandez", "Martinez", "Lopez", "Gonzalez", "Rodriguez", "Perez", "Sanchez", "Ramirez", "Torres",
  "Flores", "Rivera", "Gomez", "Diaz", "Reyes", "Cruz", "Morales", "Ortiz", "Gutierrez", "Chavez", "Nguyen", "Tran",
  "Pham", "Le", "Williams", "Johnson", "Brown", "Jones", "Davis", "Jackson", "Thomas", "Harris", "Robinson", "Walker",
  "Okafor", "Adeyemi", "Patel", "Khan", "Ali", "Mendoza", "Castillo", "Vasquez", "Romero", "Herrera", "Medina",
];

const CATEGORIES: QuestionCategory[] = [
  "READING_COMPREHENSION",
  "GRAMMAR",
  "VOCABULARY",
  "ALGEBRA",
  "GEOMETRY_TRIGONOMETRY",
  "ADVANCED_MATH",
  "PROBLEM_SOLVING_DATA_ANALYSIS",
];
const RW = new Set<QuestionCategory>(["READING_COMPREHENSION", "GRAMMAR", "VOCABULARY"]);
/** How this campus's students tend to sit in each skill relative to their section: Advanced Math and Grammar lag. */
const SKILL_OFFSET: Record<QuestionCategory, number> = {
  READING_COMPREHENSION: 3,
  GRAMMAR: -5,
  VOCABULARY: 4,
  ALGEBRA: 4,
  GEOMETRY_TRIGONOMETRY: 0,
  ADVANCED_MATH: -7,
  PROBLEM_SOLVING_DATA_ANALYSIS: 2,
};

// ---- Questions -------------------------------------------------------------------

type Revision = {
  questionId: string;
  revisionId: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  correctId: string | null;
  wrongIds: string[];
  accepted: string[];
};

async function loadPools() {
  const rows = await prisma.question.findMany({
    where: { status: "PUBLISHED", currentPublishedRevisionId: { not: null } },
    select: {
      id: true,
      category: true,
      difficulty: true,
      currentPublishedRevision: { select: { id: true, questionText: true, acceptedAnswers: true, answerChoices: { select: { id: true, isCorrect: true } } } },
    },
  });
  // Never build the demo on placeholder or test content: prisma/seed.ts's "[Seed] … which choice is
  // correct?" questions and e2e fixtures ("Family A 1793…") are PUBLISHED on a local database, and a
  // teacher opening a homework question would see "Choice 1 … Choice 4" (review, 2026-11-09).
  const placeholder = (text: string) => text.startsWith("[Seed]") || /^(Family [A-Z]|E2E|e2e)\b/.test(text) || /\b\d{12,}\b/.test(text);
  const real = rows.filter((q) => !placeholder(q.currentPublishedRevision!.questionText));
  if (real.length < rows.length) console.log(`  Skipping ${rows.length - real.length} placeholder or test questions.`);
  rows.length = 0;
  rows.push(...real);
  const byKey = new Map<string, Revision[]>();
  const byCategory = new Map<QuestionCategory, Revision[]>();
  for (const q of rows) {
    const rev = q.currentPublishedRevision!;
    const r: Revision = {
      questionId: q.id,
      revisionId: rev.id,
      category: q.category,
      difficulty: q.difficulty,
      correctId: rev.answerChoices.find((c) => c.isCorrect)?.id ?? null,
      wrongIds: rev.answerChoices.filter((c) => !c.isCorrect).map((c) => c.id),
      accepted: rev.acceptedAnswers,
    };
    byKey.set(`${q.category}:${q.difficulty}`, [...(byKey.get(`${q.category}:${q.difficulty}`) ?? []), r]);
    byCategory.set(q.category, [...(byCategory.get(q.category) ?? []), r]);
  }
  return {
    count: rows.length,
    /** A question of this skill and difficulty (the nearest if none), not in `avoid`. */
    question(category: QuestionCategory, difficulty: QuestionDifficulty, avoid?: Set<string>): Revision {
      const fresh = (list: Revision[] | undefined) => (list ?? []).filter((r) => !avoid?.has(r.questionId));
      const exact = fresh(byKey.get(`${category}:${difficulty}`));
      if (exact.length) return pick(exact);
      const loose = fresh(byCategory.get(category));
      if (loose.length) return pick(loose);
      return pick(byCategory.get(category) ?? [...byKey.values()].flat());
    },
  };
}
type Pools = Awaited<ReturnType<typeof loadPools>>;

/** An answer a student would give: the right one, or a wrong one. */
function answerFor(rev: Revision, correct: boolean): string {
  if (rev.correctId) return correct ? rev.correctId : rev.wrongIds.length ? pick(rev.wrongIds) : rev.correctId;
  const right = rev.accepted[0] ?? "1";
  if (correct) return right;
  // A wrong grid-in is a near miss (a step, a sign, a doubling), not always 0:
  // the teacher's answer spread reads "4 (right) · 0 8" otherwise.
  const n = Number(right);
  const misses = Number.isFinite(n) ? [n + 1, n - 1, -n, n * 2, n / 2].filter((v) => v !== n).map((v) => String(Math.round(v * 100) / 100)) : ["0", "1"];
  const wrong = misses.filter((v) => !rev.accepted.includes(v));
  return wrong.length ? pick(wrong) : "0";
}

/** Exactly the expected number right, the likeliest ones: for Maya, whose
 *  account a visitor opens, so her results are typical rather than a lucky or
 *  unlucky draw (a random 1/10 on homework read as a broken account). */
function expectedRights(chances: number[]): boolean[] {
  const count = Math.round(chances.reduce((sum, p) => sum + p, 0));
  const likeliest = new Set(chances.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]).slice(0, count).map(([, i]) => i));
  return chances.map((_, i) => likeliest.has(i));
}

/** The engine's own chance (its ratings are per skill since engine 2026.2, fitted to real answers). */
function chanceRight(ability: number, category: QuestionCategory, difficulty: QuestionDifficulty): number {
  return expectedProbability(questionRating(category, difficulty), ability);
}

/** Homework plays a little easier than a Practice Set (no clock, notes
 *  allowed), in ability points, so a class averages about half right. Under
 *  engine 2026.1 this was 14, because its flat ratings set every question too
 *  hard; the calibrated ratings already match how students really do. */
const HOMEWORK_EDGE = 3;

const DEMO_BAND_HALF_WIDTH = 50;

/** A prediction as the engine writes one (lib/score/predict.ts): each section scored on its own line, rounded to 10, then added. */
function prediction(studentId: string, rw: number, math: number, firstMidpoint: number | null, at: Date, sourceSetId: string | null) {
  const point = roundToStep(sectionScoreFromAbility("READING_WRITING", rw)) + roundToStep(sectionScoreFromAbility("MATH", math));
  // Engine 2026.3 stores a score with a likely band; a demo has no answers to
  // measure the band from, so it uses a typical half-width.
  const low = Math.max(400, roundToStep(point - DEMO_BAND_HALF_WIDTH));
  const high = Math.min(1600, roundToStep(point + DEMO_BAND_HALF_WIDTH));
  const ability = (rw + math) / 2;
  return {
    id: randomUUID(),
    studentId,
    sourceType: sourceSetId ? ("ADAPTIVE_SET" as const) : ("DIAGNOSTIC" as const),
    sourceSetId,
    readingWritingAbility: rw,
    mathAbility: math,
    overallAbility: ability,
    displayedRangeIndex: 0,
    displayedRangeMinimum: low,
    displayedRangeMaximum: high,
    representativeMidpoint: point,
    approximateImprovement: firstMidpoint === null ? 0 : point - firstMidpoint,
    withinRangeProgress: progressWithinRange(point, low, high),
    scoringEngineVersion: SCORING_ENGINE_VERSION,
    createdAt: at,
  };
}

async function chunked<T>(rows: T[], write: (batch: T[]) => Promise<unknown>, size = 1000) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

async function findDemo() {
  return prisma.organization.findFirst({
    where: { officialName: DISTRICT_NAME, organizationType: "DISTRICT" },
    select: { id: true, schools: { select: { id: true } } },
  });
}

// ---- check -----------------------------------------------------------------------

async function check() {
  const demo = await findDemo();
  console.log(demo ? `The Houston ISD demo exists (${demo.schools.length} campuses).` : "No Houston ISD demo yet.");
  for (const [role, email] of Object.entries(ACCOUNTS)) {
    const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
    console.log(`  ${role.padEnd(10)} ${email}: ${user ? `exists (${user.role})` : "free"}`);
  }
  const published = await prisma.question.count({ where: { status: "PUBLISHED", currentPublishedRevisionId: { not: null } } });
  console.log(`Published questions: ${published}.`);
  // Placeholder or test content anyone could be served (Practice Sets, the Daily Challenge, Guided
  // Sessions draw on every published question, not only the demo's own pools).
  const placeholders = await prisma.question.count({
    where: {
      status: "PUBLISHED",
      currentPublishedRevision: { OR: [{ questionText: { startsWith: "[Seed]" } }, { questionText: { startsWith: "Family " } }] },
    },
  });
  console.log(placeholders === 0 ? "No placeholder or test questions are published." : `${placeholders} placeholder or test questions are published: archive them before showing the demo.`);
  // The demo's dates are relative to the day it was built, so it goes stale: the open homework turns
  // overdue and Maya's last set drifts into the past. `refresh` rebuilds it as of today.
  const teacher = await prisma.user.findUnique({ where: { email: ACCOUNTS.teacher }, select: { id: true } });
  if (teacher) {
    const open = await prisma.assignment.findFirst({ where: { classroom: { teacherId: teacher.id } }, orderBy: { dueAt: "desc" }, select: { dueAt: true } });
    if (open?.dueAt) {
      const days = Math.round((open.dueAt.getTime() - Date.now()) / DAY);
      console.log(
        days >= 2
          ? `Open homework due in ${days} days: the demo is current.`
          : `Open homework ${days >= 0 ? `due in ${days} day(s)` : `${-days} day(s) overdue`}: run \`refresh\` before showing the demo.`,
      );
    }
  }
}

/** remove, then create again as of today, keeping the logins' password (read from the existing admin). */
async function refresh() {
  const admin = await prisma.user.findUnique({ where: { email: ACCOUNTS.admin }, select: { passwordHash: true } });
  if (!admin?.passwordHash && !process.env.DEMO_PASSWORD) throw new Error("No demo admin to take the password from: use `create` with DEMO_PASSWORD.");
  if (admin?.passwordHash) process.env.DEMO_PASSWORD_HASH = admin.passwordHash;
  await remove();
  await create();
}

// ---- remove ----------------------------------------------------------------------

async function remove() {
  const demo = await findDemo();
  const schoolIds = demo?.schools.map((s) => s.id) ?? [];
  const orgIds = demo ? [demo.id, ...schoolIds] : [];
  const users = await prisma.user.findMany({
    where: { OR: [{ email: { endsWith: `@${FICTION_DOMAIN}` } }, { email: { in: Object.values(ACCOUNTS) } }] },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (orgIds.length === 0 && userIds.length === 0) {
    console.log("Nothing to remove.");
    return;
  }
  await prisma.$transaction(
    async (tx) => {
      await tx.announcement.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { createdByUserId: { in: userIds } }] } });
      // Cascades guided sessions, assignments, homework and enrollments.
      await tx.classroom.deleteMany({ where: { OR: [{ schoolId: { in: orgIds } }, { teacherId: { in: userIds } }] } });
      await tx.administratorAssignment.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { userId: { in: userIds } }] } });
      // Fictional people and demo logins: hard-deleted, not anonymized; there
      // is no real history to keep. Cascades everything they did.
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      await tx.organization.deleteMany({ where: { id: { in: schoolIds } } });
      if (demo) await tx.organization.delete({ where: { id: demo.id } });
    },
    { timeout: 180_000 },
  );
  console.log(`Removed the Houston ISD demo: ${orgIds.length} organizations, ${userIds.length} accounts.`);
}

// ---- create ----------------------------------------------------------------------

type Student = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  joinedAt: number;
  grade: number;
  ability: number;
  rw: number;
  math: number;
  campus: number;
  engagement: "never" | "started" | "light" | "regular" | "keen";
  /** Final skill levels, for those who finished the Diagnostic. */
  skills: Partial<Record<QuestionCategory, number>>;
};

const hisdAdminNote = `${ACCOUNTS.admin} is the District Administrator; ${ACCOUNTS.campusAdmin} is the School Administrator of ${CAMPUSES[1].name} only.`;

async function create() {
  // DEMO_PASSWORD_HASH lets a rebuild keep the logins' existing password without anyone knowing it:
  // read the old admin's passwordHash before `remove`, then pass it here (2026-11-08).
  const keptHash = process.env.DEMO_PASSWORD_HASH ?? "";
  const password = process.env.DEMO_PASSWORD ?? "";
  if (!keptHash && password.length < 8) throw new Error("Set DEMO_PASSWORD (8+ characters) for the demo logins.");
  if (await findDemo()) throw new Error("The Houston ISD demo already exists. Run `remove` first to rebuild it.");
  const taken = await prisma.user.findMany({ where: { email: { in: Object.values(ACCOUNTS) } }, select: { email: true } });
  if (taken.length) throw new Error(`These logins already exist: ${taken.map((t) => t.email).join(", ")}. Run \`remove\` first.`);

  const pools = await loadPools();
  if (pools.count < 60) throw new Error("Too few published questions to build believable activity.");
  const passwordHash = keptHash || (await hashPassword(password));
  const unusable = await hashPassword(randomBytes(32).toString("hex"));
  const contractStart = new Date(LAUNCH - 10 * DAY);
  const contractEnd = new Date(NOW + 270 * DAY);
  const springYear = new Date(NOW).getMonth() >= 7 ? new Date(NOW).getFullYear() + 1 : new Date(NOW).getFullYear();

  // ---- Organizations
  const district = await prisma.organization.create({
    data: {
      organizationType: "DISTRICT",
      officialName: DISTRICT_NAME,
      // Co-branding display name; the Owner uploads the logo on the school page.
      brandName: "Houston ISD",
      city: "Houston",
      state: "TX",
      schoolYear: "2026-2027",
      contractStartDate: contractStart,
      contractEndDate: contractEnd,
      status: "ACTIVE",
      directoryVisible: false,
      internalNotes: MARKER,
    },
  });
  const schools = [];
  for (const campus of CAMPUSES) {
    schools.push(
      await prisma.organization.create({
        data: {
          organizationType: "SCHOOL",
          officialName: campus.name,
          city: "Houston",
          state: "TX",
          schoolYear: "2026-2027",
          contractStartDate: contractStart,
          contractEndDate: contractEnd,
          status: "ACTIVE",
          directoryVisible: false,
          parentDistrictId: district.id,
          totalEnrollment: campus.enrollment,
          internalNotes: MARKER,
        },
      }),
    );
  }
  const school = schools[0];

  const legal = { create: [{ tosVersion: CURRENT_TOS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION }] };

  // ---- The four logins
  // The district administrator sees every campus; the campus administrator only the second.
  const admin = await prisma.user.create({
    data: {
      role: "SCHOOL_ADMINISTRATOR",
      firstName: "Alex",
      email: ACCOUNTS.admin,
      emailVerified: new Date(),
      passwordHash,
      ageConfirmed: true,
      dailyReminderEnabled: false,
      createdAt: new Date(LAUNCH - 7 * DAY),
      legalAcceptances: legal,
      adminAssignments: { create: { organizationId: district.id, scope: "DISTRICT", createdAt: new Date(LAUNCH - 7 * DAY) } },
    },
  });
  const campusAdmin = await prisma.user.create({
    data: {
      role: "SCHOOL_ADMINISTRATOR",
      firstName: "Jordan",
      email: ACCOUNTS.campusAdmin,
      emailVerified: new Date(),
      passwordHash,
      ageConfirmed: true,
      dailyReminderEnabled: false,
      createdAt: new Date(LAUNCH - 6 * DAY),
      legalAcceptances: legal,
      adminAssignments: { create: { organizationId: schools[1].id, scope: "SCHOOL", createdAt: new Date(LAUNCH - 6 * DAY) } },
    },
  });
  const teacher = await prisma.user.create({
    data: {
      role: "TEACHER",
      firstName: "Elena",
      teacherDisplayName: "Ms. Rivera",
      email: ACCOUNTS.teacher,
      emailVerified: new Date(),
      passwordHash,
      ageConfirmed: true,
      dailyReminderEnabled: false,
      createdAt: new Date(LAUNCH - 3 * DAY),
      legalAcceptances: legal,
      teacherAssignments: { create: { schoolId: school.id, createdAt: new Date(LAUNCH - 3 * DAY) } },
    },
  });
  const mayaJoined = LAUNCH + 2 * DAY;
  const maya = await prisma.user.create({
    data: {
      role: "STUDENT",
      firstName: "Maya",
      email: ACCOUNTS.student,
      emailVerified: new Date(mayaJoined),
      passwordHash,
      ageConfirmed: true,
      grade: 11,
      targetScore: 1300,
      studyCommitment: "MODERATE",
      onboardingCompletedAt: new Date(mayaJoined + 3 * MINUTE),
      dailyReminderEnabled: false,
      createdAt: new Date(mayaJoined),
      legalAcceptances: legal,
    },
  });
  const diego = await prisma.user.create({
    data: {
      role: "STUDENT",
      firstName: "Diego",
      email: ACCOUNTS.newStudent,
      emailVerified: new Date(),
      passwordHash,
      ageConfirmed: true,
      dailyReminderEnabled: false,
      createdAt: new Date(NOW - 10 * MINUTE),
      legalAcceptances: legal,
    },
  });
  await prisma.studentMembership.createMany({
    data: [
      {
        studentId: maya.id,
        organizationId: district.id,
        schoolId: school.id,
        verifiedSchoolEmail: ACCOUNTS.student,
        currentGrade: 11,
        expectedGraduationYear: springYear + 1,
        status: "ACTIVE",
        activationMethod: "DOMAIN_MATCH",
        activatedAt: new Date(mayaJoined),
        celebratedAt: new Date(mayaJoined + 4 * MINUTE),
        createdAt: new Date(mayaJoined),
      },
      {
        // Celebration not yet seen: Diego meets the "Premium is free through
        // your school" moment on his first page after onboarding.
        studentId: diego.id,
        organizationId: district.id,
        schoolId: school.id,
        verifiedSchoolEmail: ACCOUNTS.newStudent,
        currentGrade: 11,
        expectedGraduationYear: springYear + 1,
        status: "ACTIVE",
        activationMethod: "DOMAIN_MATCH",
        activatedAt: new Date(NOW - 10 * MINUTE),
        createdAt: new Date(NOW - 10 * MINUTE),
      },
    ],
  });

  // ---- Fictional students
  const students: Student[] = [];
  const users = [];
  const memberships = [];
  const takenNames = new Set<string>();
  const campusOfStudent = CAMPUSES.flatMap((c, ci) => Array.from({ length: c.students }, () => ci));
  for (let n = 0; n < STUDENT_COUNT; n++) {
    const ci = campusOfStudent[n];
    // No two fictional students share a full name (two Andrea Robinsons on one campus read as generated).
    let firstName = pick(FIRST_NAMES);
    let lastName = pick(LAST_NAMES);
    while (takenNames.has(`${firstName} ${lastName}`)) {
      firstName = pick(FIRST_NAMES);
      lastName = pick(LAST_NAMES);
    }
    takenNames.add(`${firstName} ${lastName}`);
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${n + 1}@${FICTION_DOMAIN}`;
    const grade = pick([9, 10, 10, 11, 11, 11, 11, 12, 12]);
    const joinedAt = LAUNCH + (chance(0.7) ? between(0, 12) : between(12, 40)) * DAY;
    // On engine 2026.2's scale, where 50 is a typical PrepHub student (about
    // 1010). Since 2026-11-09 the district centres near 940 with a standard
    // deviation of about 12 ability points (~95 points a section; normal()'s
    // spread is twice its SD), so about 54% meet the Reading & Writing TSI
    // benchmark, 22% Math and 22% both: a large urban district, where before
    // (centre 860, SD 6) only 1% met Math and the district readiness panel
    // read "0 met it".
    const ability = clamp(normal(43 + CAMPUSES[ci].lift + (grade - 9) * 1.5, 24), 8, 85);
    // Sections differ by about 70 points either way (SAT sections correlate near 0.75), so some
    // students miss only Reading & Writing; with a tighter tilt no campus ever showed one.
    // About one in eight leans clearly toward Math, as many English learners do (Reading & Writing a
    // section behind), so "Reading & Writing only" is a real group, not 0 or 1 at every campus.
    const tilt = chance(0.15) ? normal(-26, 8) : normal(0, 18);
    const roll = clamp(rand() - CAMPUSES[ci].quiet, 0, 0.999);
    const engagement = roll < 0.12 ? "never" : roll < 0.2 ? "started" : roll < 0.48 ? "light" : roll < 0.84 ? "regular" : "keen";
    const id = randomUUID();
    students.push({ id, firstName, lastName, email, joinedAt, grade, ability, campus: ci, rw: ability + tilt / 2, math: ability - tilt / 2, engagement, skills: {} });
    users.push({
      id,
      role: "STUDENT" as const,
      firstName,
      email,
      passwordHash: unusable,
      grade,
      ageConfirmed: true,
      onboardingCompletedAt: new Date(joinedAt + 3 * MINUTE),
      targetScore: pick([1010, 1100, 1165, 1245, 1325]),
      studyCommitment: pick(["LIGHT", "MODERATE", "INTENSIVE", "FEW_TIMES_WEEK"] as const),
      dailyReminderEnabled: false,
      createdAt: new Date(joinedAt),
    });
    memberships.push({
      studentId: id,
      organizationId: district.id,
      schoolId: schools[ci].id,
      verifiedSchoolEmail: email,
      currentGrade: grade,
      expectedGraduationYear: springYear + (12 - grade),
      status: "ACTIVE" as const,
      activationMethod: chance(0.6) ? ("DOMAIN_MATCH" as const) : ("ROSTER" as const),
      activatedAt: new Date(joinedAt),
      celebratedAt: new Date(joinedAt),
      createdAt: new Date(joinedAt),
    });
  }
  await chunked(users, (batch) => prisma.user.createMany({ data: batch }));
  await chunked(memberships, (batch) => prisma.studentMembership.createMany({ data: batch }));

  // Diagnostics, practice and predictions, written directly.
  const diagnosticSessions = [];
  const diagnosticAttempts = [];
  const practiceSets = [];
  const slots = [];
  const attempts = [];
  const predictions = [];
  const categoryStates = [];
  for (const s of students) {
    if (s.engagement === "never") continue;
    const sessionId = randomUUID();
    const startedAt = s.joinedAt + between(4, 60) * MINUTE;
    const finished = s.engagement !== "started";
    const sequence = [...CORE_SEQUENCE, ...BONUS_SEQUENCE];
    const tookBonus = finished && chance(0.55);
    const answeredCount = !finished ? int(2, 9) : tookBonus ? sequence.length : CORE_SEQUENCE.length;
    let t = startedAt;
    const used = new Set<string>();
    for (let position = 0; position < sequence.length; position++) {
      const slot = sequence[position];
      const rev = pools.question(slot.category, slot.difficulty, used);
      used.add(rev.questionId);
      const answered = position < answeredCount;
      if (answered) t += between(0.6, 2.4) * MINUTE;
      const correct = answered && chance(chanceRight(RW.has(slot.category) ? s.rw : s.math, slot.category, slot.difficulty));
      diagnosticAttempts.push({
        id: randomUUID(),
        diagnosticSessionId: sessionId,
        position,
        category: slot.category,
        difficulty: slot.difficulty,
        questionId: rev.questionId,
        questionRevisionId: rev.revisionId,
        answer: answered ? answerFor(rev, correct) : null,
        isBlank: answered ? false : null,
        isCorrect: answered ? correct : null,
        submittedAt: answered ? new Date(t) : null,
        waivedAt: finished && !answered ? new Date(t) : null,
      });
    }
    diagnosticSessions.push({
      id: sessionId,
      studentId: s.id,
      status: finished ? ("COMPLETED" as const) : ("IN_PROGRESS" as const),
      currentPosition: finished ? answeredCount - 1 : answeredCount,
      format: "STAGED" as const,
      startedAt: new Date(startedAt),
      completedAt: finished ? new Date(t) : null,
    });
    if (!finished) continue;

    // A first Diagnostic underestimates some students (a new format, nerves): about three in ten read a
    // little low the first time, and their first sets correct it. It is also how most real crossings of
    // the TSI line happen in a first few weeks (review, 2026-11-09: "Crossed: fewer than 5" district-wide).
    const firstDip = chance(0.3) ? between(0.5, 2.5) : 0;
    const diagnosticEntry = prediction(s.id, s.rw - firstDip, s.math - firstDip, null, new Date(t + MINUTE), null);
    const first = diagnosticEntry.representativeMidpoint;
    predictions.push(diagnosticEntry);
    const sets = s.engagement === "light" ? int(0, 2) : s.engagement === "regular" ? int(2, 6) : int(6, 12);
    let ability = s.ability;
    let rw = s.rw;
    let math = s.math;
    const span = NOW - t - DAY;
    // How much this student's level rises per finished set, in ability points
    // (about 15 SAT points each when both sections move): a believable campus gains
    // tens of points over a few weeks, not hundreds, and some students dip. A
    // district will check. Per-answer steps alone (right up, wrong down)
    // netted to zero at these students' accuracy, and the Overview read
    // "average gain -8". Halved on 2026-11-09 so the demo agrees with the Houston flyer's
    // research-based projection: students with 4+ hours (most of them 5-10 hours) land near +35-40,
    // about what College Board reports for 6-8 hours of practice beyond normal growth, not +60.
    const learning = between(0.03, 0.4);
    for (let k = 0; k < sets; k++) {
      const setGain = learning + normal(0, 1.0);
      const setId = randomUUID();
      const created = t + DAY * 0.5 + (span * (k + rand() * 0.8)) / Math.max(sets, 1);
      if (created > NOW - 30 * MINUTE) break;
      let at = created + between(1, 30) * HOUR;
      if (at > NOW - 20 * MINUTE) at = created;
      const started = at;
      for (let position = 0; position < 21; position++) {
        const category = CATEGORIES[position % CATEGORIES.length];
        const difficulty = pick(["EASY", "MEDIUM", "MEDIUM", "HARD"] as const);
        const rev = pools.question(category, difficulty);
        const correct = chance(chanceRight(RW.has(category) ? rw : math, category, difficulty));
        at += between(0.7, 2.2) * MINUTE;
        const slotId = randomUUID();
        slots.push({
          id: slotId,
          practiceSetId: setId,
          position,
          plannedCategory: category,
          plannedDifficulty: difficulty,
          resolvedCategory: category,
          resolvedDifficulty: difficulty,
          questionId: rev.questionId,
          questionRevisionId: rev.revisionId,
        });
        // The set's gain spread over its answers, a right answer moving more.
        const change = setGain / 21 + (correct ? 0.05 : -0.03);
        attempts.push({
          id: randomUUID(),
          studentId: s.id,
          practiceSetId: setId,
          blueprintSlotId: slotId,
          questionId: rev.questionId,
          category,
          difficulty,
          answer: answerFor(rev, correct),
          isBlank: false,
          isCorrect: correct,
          expectedProbability: chanceRight(RW.has(category) ? rw : math, category, difficulty),
          kValue: 1,
          abilityBefore: ability,
          rawAbilityChange: change,
          appliedAbilityChange: change,
          abilityAfter: ability + change,
          finalizedAt: new Date(at),
          engineVersion: "demo",
        });
        ability += change;
        if (RW.has(category)) rw += change * 1.6;
        else math += change * 1.2;
      }
      practiceSets.push({
        id: setId,
        studentId: s.id,
        setNumber: k + 1,
        status: "COMPLETED" as const,
        engineVersion: "demo",
        randomSeed: "demo",
        currentPosition: 20,
        createdAt: new Date(created),
        startedAt: new Date(started),
        completedAt: new Date(at),
      });
      predictions.push(prediction(s.id, rw, math, first, new Date(at + 5000), setId));
    }
    // Skill levels: what the Guided Session pick and the teacher's setup read.
    for (const category of CATEGORIES) {
      const base = RW.has(category) ? rw : math;
      const level = clamp(base + SKILL_OFFSET[category] + normal(0, 6), 2, 98);
      s.skills[category] = level;
      categoryStates.push({
        studentId: s.id,
        category,
        ability: level,
        initialAbility: clamp(level - between(0, 4), 0, 100),
        adaptiveQuestionsAnswered: sets * 3,
        lastAbilityUpdatedAt: new Date(t + sets * 3 * DAY),
      });
    }
  }
  await chunked(diagnosticSessions, (b) => prisma.diagnosticSession.createMany({ data: b }));
  await chunked(diagnosticAttempts, (b) => prisma.diagnosticAttempt.createMany({ data: b }));
  await chunked(practiceSets, (b) => prisma.practiceSet.createMany({ data: b }));
  await chunked(slots, (b) => prisma.blueprintSlot.createMany({ data: b }));
  await chunked(attempts, (b) => prisma.finalizedAttempt.createMany({ data: b }));
  await chunked(predictions, (b) => prisma.predictionHistoryEntry.createMany({ data: b }));
  await chunked(categoryStates, (b) => prisma.categoryState.createMany({ data: b }));
  console.log(`  ${students.length} fictional students, ${practiceSets.length} Practice Sets.`);

  // ---- Maya, through the real engine
  await buildMaya(maya.id, mayaJoined, pools);
  console.log("  Maya: Diagnostic and four Practice Sets through the engine, a fifth waiting.");

  // ---- Teachers and classes
  const active = students.filter((s) => s.engagement !== "never" && s.engagement !== "started");
  const mayaStudent = { id: maya.id, lastName: "Ramirez", joinedAt: mayaJoined };
  const diegoStudent = { id: diego.id, lastName: "Torres", joinedAt: NOW - 8 * MINUTE };
  const activeAt = (ci: number) => active.filter((s) => s.campus === ci);
  const roster3 = shuffled(activeAt(0)).slice(0, 22);
  const roster6 = shuffled(activeAt(0).filter((s) => !roster3.includes(s))).slice(0, 20);
  const fictionalTeachers = CAMPUS_TEACHERS.flatMap((list, ci) =>
    list.map(([firstName, display, handle, className]) => ({
      campus: ci,
      firstName,
      display,
      email: `${handle}@${FICTION_DOMAIN}`,
      className,
    })),
  );

  const third = await prisma.classroom.create({
    data: { teacherId: teacher.id, schoolId: school.id, name: "SAT Prep · 3rd period", joinCode: generateJoinCode(), createdAt: new Date(LAUNCH) },
  });
  const sixth = await prisma.classroom.create({
    data: { teacherId: teacher.id, schoolId: school.id, name: "SAT Prep · 6th period", joinCode: generateJoinCode(), createdAt: new Date(LAUNCH) },
  });
  const enroll = async (classroomId: string, roster: { id: string; lastName: string; joinedAt: number }[], extra: string[] = []) =>
    prisma.classroomEnrollment.createMany({
      data: roster.map((s) => ({
        classroomId,
        studentId: s.id,
        lastName: s.lastName,
        joinedAt: new Date(Math.max(s.joinedAt, LAUNCH + DAY) + (s.id === diego.id ? 0 : between(0, 2) * DAY)),
        extraTime: (extra.includes(s.id) ? (s.id === extra[0] ? "TIME_AND_HALF" : "DOUBLE") : "NONE") as ExtraTime,
      })),
    });
  await enroll(third.id, [mayaStudent, diegoStudent, ...roster3], [roster3[3].id, roster3[11].id]);
  await enroll(sixth.id, roster6, [roster6[5].id]);

  const otherClasses: { id: string; roster: Student[] }[] = [];
  for (const t of fictionalTeachers) {
    const user = await prisma.user.create({
      data: {
        role: "TEACHER",
        firstName: t.firstName,
        teacherDisplayName: t.display,
        email: t.email,
        passwordHash: unusable,
        ageConfirmed: true,
        createdAt: new Date(LAUNCH - 2 * DAY),
        teacherAssignments: { create: { schoolId: schools[t.campus].id, createdAt: new Date(LAUNCH - 2 * DAY) } },
      },
    });
    const classroom = await prisma.classroom.create({
      data: { teacherId: user.id, schoolId: schools[t.campus].id, name: t.className, joinCode: generateJoinCode(), createdAt: new Date(LAUNCH + DAY) },
    });
    const campusActive = activeAt(t.campus);
    const roster = shuffled(campusActive).slice(0, Math.min(campusActive.length, int(14, 22)));
    if (roster.length === 0) continue;
    await enroll(classroom.id, roster);
    otherClasses.push({ id: classroom.id, roster });
    await addHomework(classroom.id, roster, pools, [
      { title: t.className.includes("Math") ? "Quadratics and exponentials" : "Words in context", categories: t.className.includes("Math") ? ["ADVANCED_MATH"] : ["VOCABULARY"] },
      { title: t.className.includes("Math") ? "Linear systems" : "Central ideas and structure", categories: t.className.includes("Math") ? ["ALGEBRA"] : ["READING_COMPREHENSION"] },
    ]);
    await addGuidedSession({
      classroomId: classroom.id,
      teacherId: user.id,
      roster: roster.map((s) => ({ id: s.id, skills: s.skills })),
      category: t.className.includes("Math") ? "ALGEBRA" : "READING_COMPREHENSION",
      daysAgo: 6,
      pools,
    });
  }

  // Ms. Rivera's homework: three for 3rd period (Maya finishes the past two;
  // the newest is open and on her to-do list), two for 6th. Maya answers at
  // her real skill levels, read back from the engine's rows buildMaya left.
  const mayaSkills = await prisma.categoryState.findMany({ where: { studentId: maya.id }, select: { category: true, ability: true } });
  const mayaSkillMap = Object.fromEntries(mayaSkills.map((c) => [c.category, c.ability])) as Partial<Record<QuestionCategory, number>>;
  const mayaHw = { id: maya.id, skills: mayaSkillMap };
  await addHomework(
    third.id,
    roster3,
    pools,
    [
      { title: "Linear equations and inequalities", categories: ["ALGEBRA"], mode: "PRACTICE" },
      { title: "Punctuation: boundaries", categories: ["GRAMMAR"], mode: "PRACTICE" },
      { title: "Quiz: quadratics", categories: ["ADVANCED_MATH"], mode: "QUIZ" },
    ],
    mayaHw,
  );
  await addHomework(sixth.id, roster6, pools, [
    { title: "Data and statistics", categories: ["PROBLEM_SOLVING_DATA_ANALYSIS"] },
    { title: "Transitions and logic", categories: ["GRAMMAR"] },
  ]);

  // Past Guided Sessions: two in 3rd period (Maya took part in both), one in 6th.
  const thirdRoster = [{ id: maya.id, skills: mayaSkillMap, always: true }, ...roster3.map((s) => ({ id: s.id, skills: s.skills }))];
  await addGuidedSession({ classroomId: third.id, teacherId: teacher.id, roster: thirdRoster, category: "ADVANCED_MATH", daysAgo: 12, pools, twin: true, extraTimeIds: [roster3[3].id, roster3[11].id] });
  await addGuidedSession({ classroomId: third.id, teacherId: teacher.id, roster: thirdRoster, category: "GRAMMAR", daysAgo: 5, pools, extraTimeIds: [roster3[3].id, roster3[11].id] });
  await addGuidedSession({ classroomId: sixth.id, teacherId: teacher.id, roster: roster6.map((s) => ({ id: s.id, skills: s.skills })), category: "ALGEBRA", daysAgo: 8, pools, extraTimeIds: [roster6[5].id] });
  // The second mode the district asked about, so its report can be shown without running one live.
  await addIndividualSession({ classroomId: sixth.id, teacherId: teacher.id, roster: roster6.map((s) => ({ id: s.id, skills: s.skills, ability: s.ability })), daysAgo: 2, pools });
  void otherClasses;

  // ---- Community goal and announcements
  const goalStart = new Date(NOW - 21 * DAY);
  // Counted the way the Community page counts (every kind of answer), so the goal reads about 62%
  // done; counting Practice Set answers alone left it at 4,945 of 5,000 (review, 2026-11-09).
  const memberIds = (await prisma.studentMembership.findMany({ where: { schoolId: school.id, status: "ACTIVE" }, select: { studentId: true } })).map((m) => m.studentId);
  const answeredSince = await countAnswers(memberIds, goalStart);
  const target = Math.max(1000, Math.round(answeredSince / 0.62 / 500) * 500);
  await prisma.organization.update({
    where: { id: school.id },
    data: {
      communityGoalMetric: "QUESTIONS_ANSWERED",
      communityGoalTarget: target,
      communityGoalPrize: "Free admission to the next home football game",
      communityGoalStartsAt: goalStart,
      communityGoalEndsAt: new Date(NOW + 21 * DAY),
    },
  });
  // Every other campus has a goal of its own too, each about 60% done, so no campus reads as half set
  // up five weeks in (review, 2026-11-09: four of five showed "Getting started: set a goal").
  const PRIZES = ["Extra lunch period on Friday", "A pizza party for the campus", "Free tickets to the spring play", "Front-of-line passes at the next pep rally"];
  const campusTargets: number[] = [];
  for (let i = 1; i < schools.length; i++) {
    const ids = (await prisma.studentMembership.findMany({ where: { schoolId: schools[i].id, status: "ACTIVE" }, select: { studentId: true } })).map((m) => m.studentId);
    const answered = await countAnswers(ids, goalStart);
    const campusTarget = Math.max(250, Math.round(answered / between(0.55, 0.7) / 250) * 250);
    campusTargets.push(campusTarget);
    await prisma.organization.update({
      where: { id: schools[i].id },
      data: {
        communityGoalMetric: "QUESTIONS_ANSWERED",
        communityGoalTarget: campusTarget,
        communityGoalPrize: PRIZES[(i - 1) % PRIZES.length],
        communityGoalStartsAt: goalStart,
        communityGoalEndsAt: new Date(NOW + 21 * DAY),
      },
    });
  }
  await prisma.announcement.createMany({
    data: [
      {
        organizationId: school.id,
        title: "SAT School Day is in the spring",
        message: "Juniors take the SAT here at school in the spring. Keep up your Practice Sets: every one updates your predicted score.",
        publishedAt: new Date(NOW - 4 * DAY),
        expiresAt: new Date(NOW + 40 * DAY),
        createdByUserId: admin.id,
      },
      {
        organizationId: school.id,
        title: "School goal: free football game",
        message: `If we answer ${target.toLocaleString()} questions together before the deadline, every student gets free admission to the next home football game. Check School Community for how close we are.`,
        publishedAt: new Date(NOW - 20 * DAY),
        expiresAt: new Date(NOW + 21 * DAY),
        createdByUserId: admin.id,
      },
      // One welcome each on the other campuses; Northside's from its own administrator.
      ...schools.slice(1).map((sc, k) => ({
        organizationId: sc.id,
        title: "Practice before SAT School Day",
        message: `Our campus goal is ${campusTargets[k].toLocaleString()} questions together by the deadline. Every Practice Set counts, and so does homework and every Guided Session in class.`,
        publishedAt: new Date(NOW - (6 + k) * DAY),
        expiresAt: new Date(NOW + 30 * DAY),
        createdByUserId: k === 0 ? campusAdmin.id : admin.id,
      })),
    ],
  });

  console.log(
    [
      `Created ${DISTRICT_NAME} with ${schools.length} campuses: ${CAMPUSES.map((c) => c.name).join("; ")}.`,
      `  ${hisdAdminNote}`,
      `  Logins (password as given): ${Object.values(ACCOUNTS).join(", ")}`,
      `  Class codes: 3rd period ${third.joinCode}, 6th period ${sixth.joinCode}.`,
      `  Community goal: ${target.toLocaleString()} questions.`,
    ].join("\n"),
  );
}

/**
 * Maya's Diagnostic and four Practice Sets through the real engine, answering
 * the way a student near the line does and improving as she goes; then her
 * history is spread over the weeks since she joined, because the engine
 * stamps every row "now".
 */
async function buildMaya(studentId: string, joinedAt: number, pools: Pools) {
  const answerOf = async (revisionId: string, correct: boolean) => {
    const rev = await prisma.questionRevision.findUniqueOrThrow({
      where: { id: revisionId },
      select: { acceptedAnswers: true, answerChoices: { select: { id: true, isCorrect: true } } },
    });
    if (rev.answerChoices.length > 0) {
      const right = rev.answerChoices.find((c) => c.isCorrect)!.id;
      const wrong = rev.answerChoices.filter((c) => !c.isCorrect).map((c) => c.id);
      return correct || wrong.length === 0 ? right : pick(wrong);
    }
    return correct ? (rev.acceptedAnswers[0] ?? "1") : "0";
  };
  void pools;

  // The Diagnostic, answered to a fixed pattern (Easy / Medium / Hard right)
  // so she starts at 970-1040, about three hundred points under her 1300
  // target. Random answers swing the engine's three-questions-per-skill start
  // by hundreds of points. "Easy right, Medium wrong" is also the pattern on
  // which the Diagnostic's score table (lib/score) and the engine's starting
  // level (lib/adaptive) agree, so her first Practice Set doesn't jump.
  const pattern: Record<QuestionCategory, [boolean, boolean, boolean]> = {
    READING_COMPREHENSION: [true, false, false],
    GRAMMAR: [true, false, false],
    VOCABULARY: [true, true, false],
    ALGEBRA: [true, false, false],
    GEOMETRY_TRIGONOMETRY: [true, false, false],
    ADVANCED_MATH: [true, false, false],
    PROBLEM_SOLVING_DATA_ANALYSIS: [true, false, false],
  };
  const tier = { EASY: 0, MEDIUM: 1, HARD: 2 } as const;
  const session = await startOrResumeDiagnostic(studentId);
  for (const attempt of session.attempts.filter((a) => a.difficulty !== "HARD")) {
    const right = pattern[attempt.category][tier[attempt.difficulty]];
    await finalizeDiagnosticAttempt(studentId, attempt.id, await answerOf(attempt.questionRevisionId, right));
  }
  const advanced = await advanceDiagnostic(studentId);
  if (advanced.kind === "BONUS") {
    const open = await prisma.diagnosticAttempt.findMany({
      where: { diagnosticSessionId: session.id, difficulty: "HARD", submittedAt: null, waivedAt: null },
    });
    for (const attempt of open) {
      await finalizeDiagnosticAttempt(studentId, attempt.id, await answerOf(attempt.questionRevisionId, pattern[attempt.category][2]));
    }
    await advanceDiagnostic(studentId);
  }
  await finalizeDiagnosticCompletion(studentId);

  // Four Practice Sets, steered so each skill climbs a couple of points a set
  // (Advanced Math, her class's focus, slowest):
  // she answers right while below that set's target and wrong once above it
  // (with a little noise in the first two sets only), which keeps her accuracy
  // near half, as a real student's is on questions pitched at her level. Left
  // to chance, the engine's early adjustments swing a skill by tens of points
  // a set; and noise in the last sets let one run end on a drop (Set 4 read
  // "1130-1200 to 1050-1120"), since her level sits near a range boundary.
  const start = await prisma.categoryState.findMany({ where: { studentId }, select: { category: true, ability: true } });
  const startOf = Object.fromEntries(start.map((c) => [c.category, c.ability])) as Record<QuestionCategory, number>;
  const owed: Partial<Record<QuestionCategory, number>> = {};
  for (let k = 1; k <= 4; k++) {
    // Each set aims a step above where the last completed set left her: completing a set re-estimates
    // every skill from her whole history, and aiming at a fixed start + k pulled her back down after
    // that re-estimate (930, 1000, 950, 970, 960).
    const now = await prisma.categoryState.findMany({ where: { studentId }, select: { category: true, ability: true } });
    const base = k === 1 ? startOf : (Object.fromEntries(now.map((c) => [c.category, c.ability])) as Record<QuestionCategory, number>);
    const set = await generatePracticeSet(studentId);
    const setSlots = await prisma.blueprintSlot.findMany({ where: { practiceSetId: set.id }, orderBy: { position: "asc" } });
    for (const slot of setSlots) {
      const state = await prisma.categoryState.findUniqueOrThrow({
        where: { studentId_category: { studentId, category: slot.resolvedCategory } },
        select: { ability: true },
      });
      // Answer as a student at this set's target level would, on average: each question's chance at
      // the target is added to what she "owes" the skill, and she answers right once that reaches a
      // half. The whole-history estimate a completed set recomputes then settles near the target,
      // where steering on the running estimate overshot (930, 1100, 910, 1050: review, 2026-11-09).
      void state;
      const perSet = slot.resolvedCategory === "ADVANCED_MATH" ? 1.5 : slot.resolvedCategory === "GEOMETRY_TRIGONOMETRY" ? 2 : 3;
      const target = base[slot.resolvedCategory] + perSet;
      const owes = (owed[slot.resolvedCategory] ?? 0) + chanceRight(target, slot.resolvedCategory, slot.resolvedDifficulty);
      const right = owes >= 0.5;
      owed[slot.resolvedCategory] = right ? owes - 1 : owes;
      await finalizeAnswer({ studentId, blueprintSlotId: slot.id, answer: await answerOf(slot.questionRevisionId, right), isBlank: false });
    }
    // The product's own completion: the set, its prediction, and the next set
    // generated (the fifth is the one waiting for whoever signs in).
    await finalizePracticeSetCompletion(studentId, set.id);
  }

  // ---- Spread her history over the weeks since she joined.
  const diagStart = afternoon(joinedAt + 1 * DAY, 19);
  const diag = await prisma.diagnosticSession.findUniqueOrThrow({ where: { studentId }, include: { attempts: { orderBy: { position: "asc" } } } });
  let t = diagStart;
  for (const a of diag.attempts) {
    if (a.submittedAt) {
      t += between(0.8, 2.2) * MINUTE;
      await prisma.diagnosticAttempt.update({ where: { id: a.id }, data: { submittedAt: new Date(t) } });
    } else if (a.waivedAt) {
      await prisma.diagnosticAttempt.update({ where: { id: a.id }, data: { waivedAt: new Date(t) } });
    }
  }
  await prisma.diagnosticSession.update({ where: { id: diag.id }, data: { startedAt: new Date(diagStart), completedAt: new Date(t) } });
  await prisma.predictionHistoryEntry.updateMany({ where: { studentId, sourceType: "DIAGNOSTIC" }, data: { createdAt: new Date(t + 20_000) } });

  // Set 1 thirty days ago, then every week or so, set 4 yesterday (so her streak isn't 0 on the day
  // the demo is built).
  const days = [30, 21, 12, 1];
  const sets = await prisma.practiceSet.findMany({ where: { studentId }, orderBy: { setNumber: "asc" } });
  let previousDone = t + 20_000;
  for (const set of sets) {
    const index = set.setNumber - 1;
    if (set.status !== "COMPLETED" || index >= days.length) {
      // The waiting set was generated when the last one finished.
      await prisma.practiceSet.update({ where: { id: set.id }, data: { createdAt: new Date(previousDone + 5000) } });
      continue;
    }
    const start = afternoon(NOW - days[index] * DAY, between(16.5, 20.5));
    let at = start;
    const answers = await prisma.finalizedAttempt.findMany({ where: { practiceSetId: set.id }, include: { blueprintSlot: { select: { position: true } } } });
    for (const a of answers.sort((x, y) => x.blueprintSlot.position - y.blueprintSlot.position)) {
      at += between(0.7, 2.1) * MINUTE;
      await prisma.finalizedAttempt.update({ where: { id: a.id }, data: { finalizedAt: new Date(at) } });
    }
    await prisma.practiceSet.update({
      where: { id: set.id },
      data: { createdAt: new Date(previousDone + 5000), startedAt: new Date(start), completedAt: new Date(at + MINUTE) },
    });
    await prisma.predictionHistoryEntry.updateMany({ where: { studentId, sourceSetId: set.id }, data: { createdAt: new Date(at + MINUTE + 5000) } });
    previousDone = at + MINUTE + 5000;
  }
  await prisma.categoryState.updateMany({ where: { studentId }, data: { lastAbilityUpdatedAt: new Date(previousDone) } });
}

/** Homework for one class; past ones are due, the newest is open. */
async function addHomework(
  classroomId: string,
  roster: Student[],
  pools: Pools,
  plans: { title: string; categories: QuestionCategory[]; mode?: "PRACTICE" | "QUIZ" }[],
  maya?: { id: string; skills: Partial<Record<QuestionCategory, number>> },
) {
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const createdAt = schoolDay(NOW - (plans.length - i) * between(6, 9) * DAY);
    const open = i === plans.length - 1;
    // Due 9-12 days out, so a demo stays current for a week after it is built (`check` says when to refresh).
    // Due at the end of a school day, as the product sets it: a past one at 3pm made students who
    // finished that evening "Late" on the due date.
    const dueAt = afternoon(schoolDay(open ? NOW + int(9, 12) * DAY : createdAt + 7 * DAY), 23.98);
    const used = new Set<string>();
    const questions = Array.from({ length: int(8, 10) }, (_, position) => {
      // A teacher's mix: mostly Easy and Medium, a Hard one or two to stretch.
      const rev = pools.question(plan.categories[position % plan.categories.length], pick(["EASY", "EASY", "MEDIUM", "MEDIUM", "HARD"] as const), used);
      used.add(rev.questionId);
      return { position, rev };
    });
    const assignment = await prisma.assignment.create({
      data: {
        classroomId,
        title: plan.title,
        mode: plan.mode ?? "PRACTICE",
        instructions: i === 0 ? "Work these on paper first, then enter your answers. We'll go over the hardest two in class." : null,
        dueAt: new Date(dueAt),
        createdAt: new Date(createdAt),
        reminderQueuedAt: open ? null : new Date(dueAt - DAY),
        questions: { create: questions.map((q) => ({ position: q.position, questionId: q.rev.questionId, questionRevisionId: q.rev.revisionId })) },
      },
    });
    type Taker = { id: string; skills: Partial<Record<QuestionCategory, number>>; ability: number; p: number; typical?: boolean };
    const takers: Taker[] = roster.map((s) => ({
      id: s.id,
      skills: s.skills,
      ability: s.ability,
      p: open ? 0.45 : s.engagement === "keen" ? 0.97 : s.engagement === "regular" ? 0.88 : 0.62,
    }));
    if (maya && !open) takers.push({ id: maya.id, skills: maya.skills, ability: 50, p: 1, typical: true });
    const sessions = [];
    const hwSlots = [];
    for (const s of takers) {
      if (!chance(s.p)) continue;
      const sessionId = randomUUID();
      const finishes = !open || chance(0.7);
      const startAt = afternoon(createdAt + between(1, open ? Math.max(1.2, (NOW - createdAt) / DAY - 0.3) : 6.5) * DAY);
      if (startAt > NOW - 10 * MINUTE) continue;
      const answeredCount = finishes ? questions.length : int(1, questions.length - 1);
      let at = startAt;
      // Each question at the student's level in its own skill, a step up for
      // homework: untimed, with notes, and assigned near the class's level.
      const chances = questions.map((q) => chanceRight((s.skills[q.rev.category] ?? s.ability) + HOMEWORK_EDGE, q.rev.category, q.rev.difficulty));
      const rights = s.typical ? expectedRights(chances) : chances.map((p) => chance(p));
      for (const q of questions) {
        const answered = q.position < answeredCount;
        const correct = answered && rights[q.position];
        if (answered) at += between(0.8, 2.5) * MINUTE;
        hwSlots.push({
          id: randomUUID(),
          sessionId,
          position: q.position,
          questionId: q.rev.questionId,
          questionRevisionId: q.rev.revisionId,
          answer: answered ? answerFor(q.rev, correct) : null,
          isCorrect: answered ? correct : null,
          finalizedAt: answered ? new Date(at) : null,
        });
      }
      sessions.push({
        id: sessionId,
        assignmentId: assignment.id,
        studentId: s.id,
        status: finishes ? ("COMPLETED" as const) : ("ACTIVE" as const),
        currentPosition: Math.min(answeredCount, questions.length - 1),
        createdAt: new Date(startAt),
        completedAt: finishes ? new Date(at) : null,
      });
    }
    await prisma.homeworkSession.createMany({ data: sessions });
    await chunked(hwSlots, (b) => prisma.homeworkSlot.createMany({ data: b }));
  }
}

/**
 * One finished Guided Session, as the live one would have left it: a warm-up,
 * a worked example, three class questions (the second talked over and voted
 * again; optionally "one like" the third), four own questions each, pace votes.
 */
/**
 * A past individual-practice session (mode INDIVIDUAL, each student's three weakest skills): no class
 * questions, ten own questions per student who came, answered alone with feedback, as
 * lib/guided/practice.ts deals them.
 */
async function addIndividualSession(params: {
  classroomId: string;
  teacherId: string;
  roster: { id: string; skills: Partial<Record<QuestionCategory, number>>; ability: number }[];
  daysAgo: number;
  pools: Pools;
}) {
  const { classroomId, teacherId, roster, daysAgo, pools } = params;
  const start = classTime(daysAgo, 13.5 + between(0, 0.3));
  const end = start + 24 * MINUTE;
  const count = 10;
  const session = await prisma.guidedSession.create({
    data: {
      classroomId,
      teacherId,
      category: "ALGEBRA",
      joinCode: generateJoinCode(),
      stateKey: randomBytes(18).toString("base64url"),
      status: "ENDED",
      phase: "OWN",
      mode: "INDIVIDUAL",
      perStudentSkills: true,
      version: 12,
      ownQuestionCount: count,
      ownSeconds: 1200,
      startedAt: new Date(start),
      endedAt: new Date(end),
      phaseStartedAt: new Date(start),
      createdAt: new Date(start - 3 * MINUTE),
    },
  });
  const participants = [];
  const ownSlots = [];
  for (const s of roster) {
    if (!chance(0.85)) continue;
    const joined = start + between(0.5, 4) * MINUTE;
    const weakest = (Object.keys(s.skills) as QuestionCategory[]).sort((a, b) => (s.skills[a] ?? 50) - (s.skills[b] ?? 50)).slice(0, 3);
    const skills = weakest.length ? weakest : (["ALGEBRA"] as QuestionCategory[]);
    const used = new Set<string>();
    const answered = chance(0.8) ? count : int(5, count - 1);
    let at = joined;
    for (let position = 0; position < count; position++) {
      const category = skills[position % skills.length];
      const level = s.skills[category] ?? s.ability;
      const rev = pools.question(category, sampleDifficulty(level, category, rand), used);
      used.add(rev.questionId);
      const done = position < answered;
      at += between(1, 2.2) * MINUTE;
      const right = done && chance(chanceRight(level + 2, category, rev.difficulty));
      ownSlots.push({
        sessionId: session.id,
        studentId: s.id,
        position,
        questionId: rev.questionId,
        questionRevisionId: rev.revisionId,
        difficulty: rev.difficulty,
        answer: done ? answerFor(rev, right) : null,
        isCorrect: done ? right : null,
        answeredAt: done ? new Date(Math.min(at, end - MINUTE)) : null,
      });
    }
    participants.push({
      sessionId: session.id,
      studentId: s.id,
      joinedAt: new Date(joined),
      lastSeenAt: new Date(Math.min(at, end)),
      extraTime: "NONE" as ExtraTime,
      pace: null,
      ownFinishedAt: answered === count ? new Date(Math.min(at, end - MINUTE)) : null,
    });
  }
  await prisma.guidedParticipant.createMany({ data: participants });
  await chunked(ownSlots, (b) => prisma.guidedOwnSlot.createMany({ data: b }));
}

async function addGuidedSession(params: {
  classroomId: string;
  teacherId: string;
  roster: { id: string; skills: Partial<Record<QuestionCategory, number>>; always?: boolean }[];
  category: QuestionCategory;
  daysAgo: number;
  pools: Pools;
  twin?: boolean;
  extraTimeIds?: string[];
}) {
  const { classroomId, teacherId, roster, category, daysAgo, pools, twin = false, extraTimeIds = [] } = params;
  const start = classTime(daysAgo, 10 + between(0, 0.3));
  const used = new Set<string>();
  const take = (cat: QuestionCategory, difficulty: QuestionDifficulty) => {
    const rev = pools.question(cat, difficulty, used);
    used.add(rev.questionId);
    return rev;
  };
  const plan: { kind: "WARMUP" | "EXAMPLE" | "CLASS" | "TWIN"; rev: Revision; at: number; talked?: boolean; chance?: number }[] = [
    { kind: "WARMUP", rev: take(category === "ADVANCED_MATH" ? "ALGEBRA" : category, "EASY"), at: start - 2 * MINUTE },
    { kind: "EXAMPLE", rev: take(category, "MEDIUM"), at: start + 3 * MINUTE },
    { kind: "CLASS", rev: take(category, "EASY"), at: start + 7 * MINUTE, chance: 0.78 },
    { kind: "CLASS", rev: take(category, "MEDIUM"), at: start + 10 * MINUTE, talked: true, chance: 0.5 },
    { kind: "CLASS", rev: take(category, "HARD"), at: start + 16 * MINUTE, chance: 0.3 },
  ];
  if (twin) plan.push({ kind: "TWIN", rev: take(category, "HARD"), at: start + 19 * MINUTE });
  const ownStart = start + 20 * MINUTE;
  const end = start + 31 * MINUTE;

  const session = await prisma.guidedSession.create({
    data: {
      classroomId,
      teacherId,
      category,
      joinCode: generateJoinCode(),
      stateKey: randomBytes(18).toString("base64url"),
      status: "ENDED",
      phase: "RECAP",
      position: plan.length - 1,
      version: 40,
      ownQuestionCount: 4,
      ownSeconds: 420,
      startedAt: new Date(start),
      endedAt: new Date(end),
      phaseStartedAt: new Date(end - 3 * MINUTE),
      createdAt: new Date(start - 4 * MINUTE),
      items: {
        create: plan.map((p, position) => ({
          position,
          kind: p.kind,
          questionId: p.rev.questionId,
          questionRevisionId: p.rev.revisionId,
          difficulty: p.rev.difficulty,
          plannedChance: p.chance ?? null,
          openedAt: p.kind === "WARMUP" ? null : new Date(p.at),
          revealedAt: p.kind === "EXAMPLE" ? null : new Date(p.at + 3 * MINUTE),
          talked: p.talked ?? false,
        })),
      },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });

  // A first vote is drawn around the chance the product plans for the room's
  // middle student in this skill (lib/guided/plan.ts: a start most get right,
  // a discussion question near even, a stretch below that), spread by the
  // engine's own slope for students above and below the middle. The raw curve
  // at these fixed tiers gave a weak class 4% on a Hard question, which no
  // planned session would have put in front of it; the warm-up and the twin
  // (asked after the explanation) carry no planned chance, as in the product.
  const levels = roster.map((s) => s.skills[category] ?? 35).sort((a, b) => a - b);
  const middle = levels[Math.floor(levels.length / 2)];
  const unplanned: Record<string, number> = { WARMUP: 0.75, TWIN: 0.62 };
  const chanceAt = (item: { kind: string; plannedChance: number | null }, level: number) => {
    const base = item.plannedChance ?? unplanned[item.kind] ?? 0.5;
    return 1 / (1 + Math.exp(-(Math.log(base / (1 - base)) + ((level - middle) * Math.LN10) / 40)));
  };
  // Maya's path, fixed so the account a visitor opens tells the story the
  // session is built for: the warm-up and the start right, the discussion
  // question missed alone and right after talking, the stretch missed, and
  // the one like it right after the explanation.
  const mayaFirst = new Map<string, boolean>([["WARMUP", true], ["CLASS:2", true], ["CLASS:3", false], ["CLASS:4", false], ["TWIN", true]]);
  const mayaKey = (item: { kind: string; position: number }) => (item.kind === "CLASS" ? `CLASS:${item.position}` : item.kind);

  // Who came, and who came late (a late joiner missed the warm-up and Q1).
  const absent: typeof roster = [];
  const present: { s: (typeof roster)[number]; late: boolean; level: number }[] = [];
  for (const s of roster) {
    if (!s.always && !chance(0.86)) absent.push(s);
    else present.push({ s, late: !s.always && chance(0.08), level: s.skills[category] ?? 35 });
  }
  // Each question's first votes, redrawn until the room's share lands where
  // the product's move rule (suggestMove in lib/guided/plan.ts) sends the
  // move this session shows the teacher making: the start over the 70%
  // move-on line, the discussion question between 35% and 70% (talked over),
  // the stretch under 35% (explained, then one like it), the twin back over
  // half. One draw gave a talked-over question 22%, which the rule would have
  // sent to an explanation.
  const bands: Record<string, [number, number]> = { WARMUP: [0.6, 0.85], "CLASS:2": [0.72, 0.9], "CLASS:3": [0.38, 0.62], "CLASS:4": [0.15, 0.33], TWIN: [0.52, 0.8] };
  const firstVotes = new Map<string, boolean[]>();
  for (const item of session.items) {
    if (item.kind === "EXAMPLE") continue;
    const voting = present.map((p) => !(p.late && item.position < 3));
    const [lo, hi] = bands[mayaKey(item)] ?? [0, 1];
    let votes: boolean[] = [];
    for (let attempt = 0; attempt < 300; attempt++) {
      votes = present.map((p) => (p.s.always ? (mayaFirst.get(mayaKey(item)) ?? true) : chance(chanceAt(item, p.level))));
      const counted = votes.filter((_, i) => voting[i]);
      const share = counted.filter(Boolean).length / Math.max(counted.length, 1);
      if (share >= lo && share <= hi) break;
    }
    firstVotes.set(item.id, votes);
  }

  const participants = [];
  const responses = [];
  const ownSlots = [];
  const paces: GuidedPace[] = ["ABOUT_RIGHT", "ABOUT_RIGHT", "ABOUT_RIGHT", "TOO_FAST", "TOO_SLOW"];
  const confidences: GuidedConfidence[] = ["SURE", "THINK_SO", "GUESSING"];
  for (const [index, { s, late, level }] of present.entries()) {
    participants.push({
      sessionId: session.id,
      studentId: s.id,
      joinedAt: new Date(start - between(1, 4) * MINUTE + (late ? 12 * MINUTE : 0)),
      lastSeenAt: new Date(end),
      extraTime: (extraTimeIds.includes(s.id) ? "TIME_AND_HALF" : "NONE") as ExtraTime,
      pace: chance(0.75) ? pick(paces) : null,
      ownFinishedAt: new Date(ownStart + between(4, 9) * MINUTE),
    });
    for (const item of session.items) {
      if (item.kind === "EXAMPLE") continue;
      if (late && item.position < 3) continue;
      const rev = plan[item.position].rev;
      const firstRight = firstVotes.get(item.id)![index];
      const first = answerFor(rev, firstRight);
      const firstAt = new Date(plan[item.position].at + between(25, 95) * 1000);
      let second: string | null = null;
      let secondRight: boolean | null = null;
      if (item.talked) {
        // Talking it over moves some wrong answers to right, rarely the reverse.
        secondRight = s.always ? true : firstRight ? chance(0.95) : chance(0.45);
        second = secondRight === firstRight ? first : answerFor(rev, secondRight);
      }
      responses.push({
        sessionId: session.id,
        itemId: item.id,
        studentId: s.id,
        firstAnswer: first,
        firstCorrect: firstRight,
        firstAt,
        confidence: item.kind === "WARMUP" ? null : chance(0.8) ? pick(confidences) : null,
        secondAnswer: second,
        secondCorrect: secondRight,
        secondAt: second ? new Date(firstAt.getTime() + 3 * MINUTE) : null,
      });
    }
    // Own questions: the product's draw (lib/guided/select.ts ownDifficulties
    // uses the engine's sampleDifficulty, as Practice Sets do).
    const ownUsed = new Set(used);
    const own = Array.from({ length: 4 }, () => {
      const rev = pools.question(category, sampleDifficulty(level, category, rand), ownUsed);
      ownUsed.add(rev.questionId);
      return rev;
    });
    const ownChances = own.map((rev) => chanceRight(level, category, rev.difficulty));
    const ownRights = s.always ? expectedRights(ownChances) : ownChances.map((p) => chance(p));
    for (let position = 0; position < own.length; position++) {
      const rev = own[position];
      const right = ownRights[position];
      ownSlots.push({
        sessionId: session.id,
        studentId: s.id,
        position,
        questionId: rev.questionId,
        questionRevisionId: rev.revisionId,
        difficulty: rev.difficulty,
        answer: answerFor(rev, right),
        isCorrect: right,
        answeredAt: new Date(ownStart + (position + 1) * between(1.2, 2.2) * MINUTE),
      });
    }
  }
  // Most who were away caught up within a few days, inside the catch-up
  // window. The product records a catch-up as answers marked catchUp, with
  // no participant row (lib/guided/student.ts), which is what makes the
  // report count them as "caught up since" rather than as taking part.
  for (const s of absent) {
    const at = end + between(0.7, 3) * DAY;
    if (!chance(0.65) || at > NOW - HOUR) continue;
    const level = s.skills[category] ?? 40;
    let k = 0;
    for (const item of session.items) {
      if (item.kind === "EXAMPLE") continue;
      const right = chance(chanceAt(item, level));
      responses.push({
        sessionId: session.id,
        itemId: item.id,
        studentId: s.id,
        firstAnswer: answerFor(plan[item.position].rev, right),
        firstCorrect: right,
        firstAt: new Date(at + k++ * 2 * MINUTE),
        catchUp: true,
      });
    }
  }
  await prisma.guidedParticipant.createMany({ data: participants });
  await chunked(responses, (b) => prisma.guidedResponse.createMany({ data: b }));
  await chunked(ownSlots, (b) => prisma.guidedOwnSlot.createMany({ data: b }));
}

async function main() {
  const command = process.argv[2];
  if (command === "check") await check();
  else if (command === "create") await create();
  else if (command === "remove") await remove();
  else if (command === "refresh") await refresh();
  else console.log("Usage: npx tsx scripts/demo-houston.ts check | create | remove | refresh");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
