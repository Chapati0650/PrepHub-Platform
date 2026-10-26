/**
 * A demonstration district, for showing schools what PrepHub looks like from
 * the administrator's chair (Owner request, 2026-10-24).
 *
 *   npx tsx scripts/demo-district.ts check  --admin=<email>   reports, writes nothing
 *   npx tsx scripts/demo-district.ts create --admin=<email>   builds the demo
 *       [--convert-student]  the email belongs to a student account: make it
 *                            the administrator (remove turns it back)
 *   npx tsx scripts/demo-district.ts teacher --teacher=<email> gives that real
 *       account a teacher's view of the demo: Maria Alvarez's two classes,
 *       their fictional students and five homework assignments with results
 *       [--convert-student]  the email belongs to a student account: make it
 *                            the teacher (remove turns it back)
 *   npx tsx scripts/demo-district.ts remove                   deletes every demo row
 *
 * The administrator account (and, if added, the demo teacher's) are the only
 * real accounts involved, so the script records how it got each — created,
 * already in that role, or converted from a student — and `remove` undoes
 * exactly that: deletes an account it created, turns a converted one back into
 * a student with its history intact, and leaves any other account alone.
 *
 * Against production, with the Neon URL from the gitignored .env.neon (see the
 * production-status notes): DATABASE_URL="$NEON" npx tsx scripts/demo-district.ts check --admin=...
 *
 * What it makes: "PrepHub Demo ISD" with one campus, "PrepHub Demo High
 * School"; ~200 fictional students with a Diagnostic, Practice Sets,
 * predictions that move the way real ones do, and homework from four
 * fictional teachers; a community goal with a prize; two announcements; and
 * a School Administrator account for the email given, assigned to the
 * campus. Sign in as it with Google.
 *
 * **Built to sit inside production without touching anything real.**
 *  - Every fictional address is on `demo-isd.example.com`. `example.com` is
 *    reserved and can never receive mail (src/lib/email.ts drops it before
 *    the provider), and every analytics count and lifecycle email already
 *    excludes it.
 *  - No partner domain and no roster rows: district auto-enrollment never
 *    matches anyone against the demo, and a roster's existence would make
 *    every signup in production pay for an eligibility lookup.
 *  - Hidden from the school directory; no 1v1 Rush or Daily Challenge rows,
 *    so no real student is ever matched against, or ranked beside, a
 *    fictional one; homework and practice live only in the demo's own rows.
 *  - The fictional accounts have no usable password and no Google identity,
 *    so nobody can sign in as one.
 *
 * Answer rows point at real published questions (they must — every slot has
 * a foreign key to a question revision), which is harmless: nothing in the
 * product reports per-question statistics. `remove` deletes all of it.
 *
 * Deterministic: a fixed seed, so "create" after "remove" builds the same
 * school, with dates shifted to today.
 */
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient, type QuestionCategory, type QuestionDifficulty } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { rangeForAbility, SCORING_ENGINE_VERSION } from "../src/lib/score/config";
import { CORE_SEQUENCE, BONUS_SEQUENCE } from "../src/lib/diagnostic/sequence";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DISTRICT_NAME = "PrepHub Demo ISD";
const SCHOOL_NAME = "PrepHub Demo High School";
const DEMO_DOMAIN = "demo-isd.example.com";
const MARKER = "DEMO DATA — created by scripts/demo-district.ts. Remove with `npx tsx scripts/demo-district.ts remove`.";
const STUDENT_COUNT = 212;
const TOTAL_ENROLLMENT = 1240;

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const NOW = Date.now();

// ---- Deterministic randomness ---------------------------------------------------

let seed = 0x9e3779b9;
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
/** Roughly normal, from three uniforms. */
const normal = (mean: number, spread: number) => mean + (rand() + rand() + rand() - 1.5) * spread;

const FIRST_NAMES = [
  "Aaliyah", "Adrian", "Aiden", "Alejandro", "Alexis", "Amara", "Andrea", "Angel", "Anthony", "Ariana", "Ashley",
  "Ava", "Benjamin", "Brianna", "Brooklyn", "Caleb", "Camila", "Carlos", "Carter", "Chloe", "Christian", "Daniel",
  "David", "Destiny", "Diego", "Dylan", "Elena", "Elijah", "Emily", "Emma", "Ethan", "Evelyn", "Gabriel", "Genesis",
  "Grace", "Hailey", "Hannah", "Isaac", "Isabella", "Isaiah", "Jacob", "Jada", "Jasmine", "Jayden", "Jordan", "Jose",
  "Joshua", "Julian", "Kayla", "Kevin", "Layla", "Leah", "Liam", "Lily", "Logan", "Lucas", "Luis", "Madison", "Malik",
  "Maria", "Mason", "Mateo", "Maya", "Mia", "Michael", "Naomi", "Natalie", "Nathan", "Nevaeh", "Noah", "Nora", "Olivia",
  "Omar", "Priya", "Rachel", "Riley", "Ryan", "Samantha", "Samuel", "Sara", "Sebastian", "Sofia", "Taylor", "Trinity",
  "Valeria", "Victoria", "Wyatt", "Xavier", "Yasmin", "Zoe",
];
const LAST_INITIALS = "ABCDEFGHJKLMNOPRSTVWY";

// ---- Arguments -----------------------------------------------------------------

const command = process.argv[2];
const adminEmail = process.argv.find((a) => a.startsWith("--admin="))?.slice("--admin=".length).trim().toLowerCase();
const convertStudent = process.argv.includes("--convert-student");
const teacherEmail = process.argv.find((a) => a.startsWith("--teacher="))?.slice("--teacher=".length).trim().toLowerCase();

type AdminOrigin = "created" | "existing-admin" | "converted-student";

/** How the administrator account was obtained, kept on the district row for `remove`. */
function adminNote(email: string, origin: AdminOrigin): string {
  return `${MARKER}\nadmin=${email}\norigin=${origin}`;
}

function readAdminNote(notes: string | null): { email: string; origin: AdminOrigin } | null {
  const email = notes?.match(/^admin=(.+)$/m)?.[1]?.trim();
  const origin = notes?.match(/^origin=(created|existing-admin|converted-student)$/m)?.[1] as AdminOrigin | undefined;
  return email && origin ? { email, origin } : null;
}

type TeacherOrigin = "created" | "existing-teacher" | "converted-student";

/** The fictional teacher whose classes a real demo teacher takes over. */
const DEMO_TEACHER_SEAT = `m.alvarez@${DEMO_DOMAIN}`;

function readTeacherNote(notes: string | null): { email: string; origin: TeacherOrigin } | null {
  const email = notes?.match(/^teacher=(.+)$/m)?.[1]?.trim();
  const origin = notes?.match(/^teacherOrigin=(created|existing-teacher|converted-student)$/m)?.[1] as TeacherOrigin | undefined;
  return email && origin ? { email, origin } : null;
}

async function findDemo() {
  return prisma.organization.findFirst({
    where: { officialName: DISTRICT_NAME, organizationType: "DISTRICT" },
    select: { id: true, internalNotes: true, schools: { select: { id: true } } },
  });
}

// ---- check ---------------------------------------------------------------------

async function check() {
  const demo = await findDemo();
  console.log(demo ? `Demo district exists (${demo.schools.length} campus).` : "No demo district yet.");
  const teacherNote = readTeacherNote(demo?.internalNotes ?? null);
  if (teacherNote) console.log(`Demo teacher: ${teacherNote.email} (${teacherNote.origin}).`);
  if (adminEmail) {
    const user = await prisma.user.findUnique({
      where: { email: adminEmail },
      select: { role: true, deletedAt: true, adminAssignments: { where: { removedAt: null }, select: { organizationId: true } } },
    });
    if (!user) console.log(`Admin email: no account yet — create will make a School Administrator for it.`);
    else
      console.log(
        `Admin email: an account exists with role ${user.role}${user.deletedAt ? " (deleted)" : ""}, ${user.adminAssignments.length} admin assignment(s).` +
          (user.role === "SCHOOL_ADMINISTRATOR"
            ? " Create will add the demo campus to it."
            : user.role === "STUDENT"
              ? " Create refuses unless given --convert-student, which makes it the administrator (remove turns it back)."
              : " Create will refuse."),
      );
  }
  const pool = await prisma.question.groupBy({
    by: ["category", "difficulty"],
    where: { status: "PUBLISHED", currentPublishedRevisionId: { not: null } },
    _count: true,
  });
  console.log(`Published questions: ${pool.reduce((n, p) => n + p._count, 0)} across ${pool.length} category/difficulty pools.`);
}

// ---- remove --------------------------------------------------------------------

async function remove() {
  const demo = await findDemo();
  const schoolIds = demo?.schools.map((s) => s.id) ?? [];
  const orgIds = demo ? [demo.id, ...schoolIds] : [];

  // The administrator: undo exactly what create recorded, and nothing else.
  const note = readAdminNote(demo?.internalNotes ?? null);
  const admin = note ? await prisma.user.findUnique({ where: { email: note.email }, select: { id: true } }) : null;
  const deleteAdmin = admin && note?.origin === "created" ? [admin.id] : [];

  // The demo teacher, the same way. Their classes are the demo's and go with
  // it below; their teacher assignment goes with the campus.
  const teacherNote = readTeacherNote(demo?.internalNotes ?? null);
  const teacher = teacherNote ? await prisma.user.findUnique({ where: { email: teacherNote.email }, select: { id: true } }) : null;
  const deleteTeacher = teacher && teacherNote?.origin === "created" ? [teacher.id] : [];

  const fictional = await prisma.user.findMany({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } }, select: { id: true } });
  const userIds = [...fictional.map((u) => u.id), ...deleteAdmin, ...deleteTeacher];

  if (orgIds.length === 0 && userIds.length === 0) {
    console.log("Nothing to remove.");
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.announcement.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { createdByUserId: { in: userIds } }] } });
      await tx.classroom.deleteMany({ where: { schoolId: { in: orgIds } } }); // cascades assignments, homework, enrollments
      await tx.administratorAssignment.deleteMany({ where: { organizationId: { in: orgIds } } });
      // A student account that was lent to the demo goes back to being one,
      // with everything it had.
      if (admin && note?.origin === "converted-student") {
        await tx.user.update({ where: { id: admin.id }, data: { role: "STUDENT" } });
      }
      if (teacher && teacherNote?.origin === "converted-student") {
        await tx.teacherAssignment.deleteMany({ where: { userId: teacher.id, schoolId: { in: schoolIds } } });
        await tx.user.update({ where: { id: teacher.id }, data: { role: "STUDENT" } });
      }
      // Fictional people: hard-deleted, not anonymized. Anonymizing exists to
      // keep a real student's history; there is no one here to keep.
      // Cascades memberships, diagnostics, practice sets, attempts, predictions.
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      await tx.organization.deleteMany({ where: { id: { in: schoolIds } } });
      if (demo) await tx.organization.delete({ where: { id: demo.id } });
    },
    { timeout: 120_000 },
  );
  const adminOutcome =
    note?.origin === "created"
      ? `deleted the administrator account it created (${note.email})`
      : note?.origin === "converted-student"
        ? `turned ${note.email} back into a student account`
        : note
          ? `removed ${note.email}'s access to the demo`
          : "found no administrator record";
  const teacherOutcome =
    teacherNote?.origin === "created"
      ? `; deleted the teacher account it created (${teacherNote.email})`
      : teacherNote?.origin === "converted-student"
        ? `; turned ${teacherNote.email} back into a student account`
        : teacherNote
          ? `; removed ${teacherNote.email}'s demo classes`
          : "";
  console.log(`Removed the demo district and ${fictional.length} fictional accounts; ${adminOutcome}${teacherOutcome}.`);
}

// ---- create --------------------------------------------------------------------

type Revision = { questionId: string; revisionId: string; correctId: string | null; wrongIds: string[] };

async function loadPools() {
  const rows = await prisma.question.findMany({
    where: { status: "PUBLISHED", currentPublishedRevisionId: { not: null } },
    select: {
      id: true,
      category: true,
      difficulty: true,
      currentPublishedRevision: { select: { id: true, answerChoices: { select: { id: true, isCorrect: true } } } },
    },
  });
  const pools = new Map<string, Revision[]>();
  const byCategory = new Map<string, Revision[]>();
  for (const q of rows) {
    const rev = q.currentPublishedRevision!;
    const revision: Revision = {
      questionId: q.id,
      revisionId: rev.id,
      correctId: rev.answerChoices.find((c) => c.isCorrect)?.id ?? null,
      wrongIds: rev.answerChoices.filter((c) => !c.isCorrect).map((c) => c.id),
    };
    const key = `${q.category}:${q.difficulty}`;
    pools.set(key, [...(pools.get(key) ?? []), revision]);
    byCategory.set(q.category, [...(byCategory.get(q.category) ?? []), revision]);
  }
  return {
    any: rows.length,
    question(category: QuestionCategory, difficulty: QuestionDifficulty): Revision {
      const exact = pools.get(`${category}:${difficulty}`);
      if (exact?.length) return pick(exact);
      const loose = byCategory.get(category);
      if (loose?.length) return pick(loose);
      return pick([...pools.values()].flat());
    },
  };
}

const CATEGORIES: QuestionCategory[] = [
  "READING_COMPREHENSION",
  "GRAMMAR",
  "VOCABULARY",
  "ALGEBRA",
  "GEOMETRY_TRIGONOMETRY",
  "ADVANCED_MATH",
  "PROBLEM_SOLVING_DATA_ANALYSIS",
];
const DIFFICULTY_OFFSET: Record<QuestionDifficulty, number> = { EASY: -8, MEDIUM: 2, HARD: 14 };

/** Correct with a probability that rises with ability over the question's difficulty. */
function answers(ability: number, difficulty: QuestionDifficulty): boolean {
  const target = 30 + DIFFICULTY_OFFSET[difficulty];
  return chance(1 / (1 + Math.exp(-(ability - target) / 8)));
}

function answerFor(rev: Revision, correct: boolean): string | null {
  if (correct) return rev.correctId ?? "0";
  return rev.wrongIds.length ? pick(rev.wrongIds) : "1";
}

function prediction(studentId: string, ability: number, rw: number, math: number, firstMidpoint: number | null, at: Date, sourceSetId: string | null) {
  const range = rangeForAbility(ability);
  return {
    id: randomUUID(),
    studentId,
    sourceType: sourceSetId ? ("ADAPTIVE_SET" as const) : ("DIAGNOSTIC" as const),
    sourceSetId,
    readingWritingAbility: rw,
    mathAbility: math,
    overallAbility: ability,
    displayedRangeIndex: range.index,
    displayedRangeMinimum: range.scoreMin,
    displayedRangeMaximum: range.scoreMax,
    representativeMidpoint: range.midpoint,
    approximateImprovement: firstMidpoint === null ? 0 : range.midpoint - firstMidpoint,
    withinRangeProgress: Math.min(1, Math.max(0, (ability - range.abilityMin) / (range.abilityMax - range.abilityMin))),
    scoringEngineVersion: SCORING_ENGINE_VERSION,
    createdAt: at,
  };
}

async function chunked<T>(rows: T[], write: (batch: T[]) => Promise<unknown>, size = 1000) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

async function create() {
  if (!adminEmail || !adminEmail.includes("@")) throw new Error("Pass the administrator's email: --admin=you@example.org");
  if (await findDemo()) throw new Error("The demo district already exists. Run `remove` first to rebuild it.");

  const existing = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: {
      id: true,
      role: true,
      deletedAt: true,
      studentMembership: { select: { id: true } },
      subscription: { select: { status: true } },
    },
  });
  let origin: AdminOrigin = "created";
  if (existing) {
    if (existing.deletedAt) throw new Error(`${adminEmail} belongs to a deleted account.`);
    if (existing.role === "SCHOOL_ADMINISTRATOR") origin = "existing-admin";
    else if (existing.role === "STUDENT" && convertStudent) {
      // An administrator must never hold a StudentMembership (it would put
      // them in a school's totals), and a live subscription would keep
      // billing an account that no longer needs one.
      if (existing.studentMembership) throw new Error(`${adminEmail} has a school membership; it can't become an administrator.`);
      if (existing.subscription && existing.subscription.status === "ACTIVE") {
        throw new Error(`${adminEmail} has an active subscription; cancel it first.`);
      }
      origin = "converted-student";
    } else {
      throw new Error(
        `${adminEmail} already has a ${existing.role} account.` +
          (existing.role === "STUDENT" ? " Pass --convert-student to make it the administrator (remove turns it back)." : ""),
      );
    }
  }

  const pools = await loadPools();
  if (pools.any < 30) throw new Error("Too few published questions to build believable activity.");

  const launch = new Date(NOW - 52 * DAY);
  const contractEnd = new Date(NOW + 300 * DAY);

  // ---- Organizations
  const district = await prisma.organization.create({
    data: {
      organizationType: "DISTRICT",
      officialName: DISTRICT_NAME,
      city: "Fairview",
      state: "TX",
      schoolYear: "2026-2027",
      contractStartDate: launch,
      contractEndDate: contractEnd,
      status: "ACTIVE",
      directoryVisible: false,
      internalNotes: adminNote(adminEmail, origin),
    },
  });
  const school = await prisma.organization.create({
    data: {
      organizationType: "SCHOOL",
      officialName: SCHOOL_NAME,
      city: "Fairview",
      state: "TX",
      schoolYear: "2026-2027",
      contractStartDate: launch,
      contractEndDate: contractEnd,
      status: "ACTIVE",
      directoryVisible: false,
      parentDistrictId: district.id,
      totalEnrollment: TOTAL_ENROLLMENT,
      internalNotes: MARKER,
    },
  });

  // ---- The administrator (real login via Google with this address)
  const admin =
    origin === "created"
      ? await prisma.user.create({
          data: { role: "SCHOOL_ADMINISTRATOR", firstName: "Demo", email: adminEmail, ageConfirmed: true },
          select: { id: true },
        })
      : origin === "converted-student"
        ? await prisma.user.update({ where: { id: existing!.id }, data: { role: "SCHOOL_ADMINISTRATOR" }, select: { id: true } })
        : { id: existing!.id };
  await prisma.administratorAssignment.create({ data: { userId: admin.id, organizationId: school.id, scope: "SCHOOL" } });

  // ---- Students
  type Student = {
    id: string;
    firstName: string;
    joinedAt: number;
    grade: number;
    ability: number;
    rw: number;
    math: number;
    engagement: "never" | "started" | "light" | "regular" | "keen";
  };
  const students: Student[] = [];
  const users = [];
  const memberships = [];
  for (let n = 0; n < STUDENT_COUNT; n++) {
    const firstName = pick(FIRST_NAMES);
    const email = `${firstName.toLowerCase()}.${LAST_INITIALS[int(0, LAST_INITIALS.length - 1)].toLowerCase()}${n + 1}@${DEMO_DOMAIN}`;
    const grade = pick([9, 10, 10, 11, 11, 11, 12, 12]);
    // Most of a campus signs up in the first fortnight after launch, then a trickle.
    const joinedAt = launch.getTime() + (chance(0.7) ? between(0, 14) : between(14, 50)) * DAY;
    const ability = Math.min(80, Math.max(8, normal(30 + (grade - 9) * 2, 26)));
    const tilt = normal(0, 10);
    const roll = rand();
    const engagement = roll < 0.14 ? "never" : roll < 0.22 ? "started" : roll < 0.52 ? "light" : roll < 0.86 ? "regular" : "keen";
    const id = randomUUID();
    students.push({ id, firstName, joinedAt, grade, ability, rw: ability + tilt / 2, math: ability - tilt / 2, engagement });
    const springYear = new Date(NOW).getMonth() >= 7 ? new Date(NOW).getFullYear() + 1 : new Date(NOW).getFullYear();
    users.push({
      id,
      role: "STUDENT" as const,
      firstName,
      email,
      grade,
      ageConfirmed: true,
      onboardingCompletedAt: new Date(joinedAt + 3 * MINUTE),
      targetScore: pick([1100, 1165, 1245, 1325, 1405]),
      studyCommitment: pick(["LIGHT", "MODERATE", "INTENSIVE", "FEW_TIMES_WEEK"] as const),
      dailyReminderEnabled: false,
      createdAt: new Date(joinedAt),
    });
    memberships.push({
      studentId: id,
      organizationId: district.id,
      schoolId: school.id,
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

  // ---- Diagnostics, practice and predictions
  const diagnosticSessions = [];
  const diagnosticAttempts = [];
  const practiceSets = [];
  const slots = [];
  const attempts = [];
  const predictions = [];

  for (const s of students) {
    if (s.engagement === "never") continue;
    const sessionId = randomUUID();
    const startedAt = s.joinedAt + between(4, 60) * MINUTE;
    const finished = s.engagement !== "started";
    // Every session holds all 21 slots, as a real staged Diagnostic does:
    // the core fourteen, then the Hard bonus round — answered when the
    // student earned and took it, otherwise waived, which scores as wrong.
    const sequence = [...CORE_SEQUENCE, ...BONUS_SEQUENCE];
    const tookBonus = finished && chance(0.55);
    const answeredCount = !finished ? int(2, 9) : tookBonus ? sequence.length : CORE_SEQUENCE.length;
    let t = startedAt;
    for (let position = 0; position < sequence.length; position++) {
      const slot = sequence[position];
      const rev = pools.question(slot.category, slot.difficulty);
      const answered = position < answeredCount;
      if (answered) t += between(0.6, 2.4) * MINUTE;
      const correct = answered && answers(s.ability, slot.difficulty);
      const waived = finished && !answered;
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
        waivedAt: waived ? new Date(t) : null,
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

    const first = rangeForAbility(s.ability).midpoint;
    predictions.push(prediction(s.id, s.ability, s.rw, s.math, null, new Date(t + MINUTE), null));

    // Practice: how many sets, spread from the Diagnostic to now, the keenest
    // still at it this week.
    const sets =
      s.engagement === "light" ? int(0, 2) : s.engagement === "regular" ? int(2, 6) : int(6, 13);
    let ability = s.ability;
    let rw = s.rw;
    let math = s.math;
    const span = NOW - t - DAY;
    for (let k = 0; k < sets; k++) {
      const setId = randomUUID();
      const created = t + DAY * 0.5 + (span * (k + rand() * 0.8)) / Math.max(sets, 1);
      if (created > NOW - 30 * MINUTE) break;
      let at = created;
      for (let position = 0; position < 21; position++) {
        const category = CATEGORIES[position % CATEGORIES.length];
        const difficulty = pick(["EASY", "MEDIUM", "MEDIUM", "HARD"] as const);
        const rev = pools.question(category, difficulty);
        const correct = answers(ability, difficulty);
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
        // Small steps: a believable campus gains tens of points over a few
        // weeks, not hundreds. A district will check.
        const change = correct ? between(0.02, 0.08) : -between(0.01, 0.04);
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
          expectedProbability: 0.5,
          kValue: 1,
          abilityBefore: ability,
          rawAbilityChange: change,
          appliedAbilityChange: change,
          abilityAfter: ability + change,
          finalizedAt: new Date(at),
          engineVersion: "demo",
        });
        ability += change;
        if (category === "READING_COMPREHENSION" || category === "GRAMMAR" || category === "VOCABULARY") rw += change * 1.6;
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
        completedAt: new Date(at),
      });
      predictions.push(prediction(s.id, ability, rw, math, first, new Date(at + 5000), setId));
    }
  }

  await chunked(diagnosticSessions, (batch) => prisma.diagnosticSession.createMany({ data: batch }));
  await chunked(diagnosticAttempts, (batch) => prisma.diagnosticAttempt.createMany({ data: batch }));
  await chunked(practiceSets, (batch) => prisma.practiceSet.createMany({ data: batch }));
  await chunked(slots, (batch) => prisma.blueprintSlot.createMany({ data: batch }));
  await chunked(attempts, (batch) => prisma.finalizedAttempt.createMany({ data: batch }));
  await chunked(predictions, (batch) => prisma.predictionHistoryEntry.createMany({ data: batch }));

  // ---- Teachers, classes and homework
  const teachers = [
    { firstName: "Maria", email: `m.alvarez@${DEMO_DOMAIN}`, classes: ["1st Period SAT Prep", "6th Period SAT Prep"] },
    { firstName: "James", email: `j.okafor@${DEMO_DOMAIN}`, classes: ["Algebra II — SAT Math"] },
    { firstName: "Priya", email: `p.raman@${DEMO_DOMAIN}`, classes: ["AP Lang — SAT Reading"] },
    { firstName: "Daniel", email: `d.whitfield@${DEMO_DOMAIN}`, classes: ["Junior Seminar"] },
  ];
  const homeworkPlans: Record<string, { title: string; categories: QuestionCategory[] }[]> = {
    "1st Period SAT Prep": [
      { title: "Diagnostic follow-up: Algebra", categories: ["ALGEBRA"] },
      { title: "Command of Evidence warm-up", categories: ["READING_COMPREHENSION"] },
      { title: "Mixed review before the practice test", categories: ["ALGEBRA", "GRAMMAR", "PROBLEM_SOLVING_DATA_ANALYSIS"] },
    ],
    "6th Period SAT Prep": [
      { title: "Linear equations", categories: ["ALGEBRA"] },
      { title: "Boundaries & punctuation", categories: ["GRAMMAR"] },
    ],
    "Algebra II — SAT Math": [
      { title: "Quadratics and exponentials", categories: ["ADVANCED_MATH"] },
      { title: "Right triangles & circles", categories: ["GEOMETRY_TRIGONOMETRY"] },
      { title: "Data & statistics", categories: ["PROBLEM_SOLVING_DATA_ANALYSIS"] },
    ],
    "AP Lang — SAT Reading": [
      { title: "Words in context", categories: ["VOCABULARY"] },
      { title: "Central ideas & structure", categories: ["READING_COMPREHENSION"] },
    ],
    "Junior Seminar": [{ title: "Week 6 mixed practice", categories: ["ALGEBRA", "READING_COMPREHENSION", "GRAMMAR"] }],
  };

  const active = students.filter((s) => s.engagement !== "never");
  // The same alphabet as lib/teacher/join-code.ts; five codes from 244 million
  // won't collide, and the unique index would say so if they did.
  const codeAlphabet = "ACDEFGHJKMNPQRTUVWXY34679";
  const nextCode = () => Array.from({ length: 6 }, () => codeAlphabet[int(0, codeAlphabet.length - 1)]).join("");

  // A hash of a secret nobody keeps: the teachers read as having signed up
  // (the admin page shows "Invited" otherwise), and still nobody can sign in
  // as one.
  const unusablePassword = await hashPassword(randomBytes(32).toString("hex"));
  for (const t of teachers) {
    const teacher = await prisma.user.create({
      data: {
        role: "TEACHER",
        firstName: t.firstName,
        email: t.email,
        passwordHash: unusablePassword,
        ageConfirmed: true,
        createdAt: new Date(launch.getTime() + 2 * DAY),
        teacherAssignments: { create: { schoolId: school.id, createdAt: new Date(launch.getTime() + 2 * DAY) } },
      },
    });
    for (const className of t.classes) {
      const classroom = await prisma.classroom.create({
        data: { teacherId: teacher.id, schoolId: school.id, name: className, joinCode: nextCode(), createdAt: new Date(launch.getTime() + 3 * DAY) },
      });
      const roster = [...active].sort(() => rand() - 0.5).slice(0, int(22, 31));
      await prisma.classroomEnrollment.createMany({
        data: roster.map((s) => ({ classroomId: classroom.id, studentId: s.id, joinedAt: new Date(Math.max(s.joinedAt, launch.getTime() + 4 * DAY) + between(0, 3) * DAY) })),
      });

      const plans = homeworkPlans[className] ?? [];
      for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        const createdAt = NOW - (plans.length - i) * between(6, 10) * DAY;
        // The newest one is still open; the rest are past due.
        const dueAt = i === plans.length - 1 ? NOW + int(2, 6) * DAY : createdAt + 7 * DAY;
        const count = int(8, 12);
        const questions = Array.from({ length: count }, (_, position) => {
          const rev = pools.question(plan.categories[position % plan.categories.length], pick(["EASY", "MEDIUM", "MEDIUM", "HARD"] as const));
          return { position, questionId: rev.questionId, questionRevisionId: rev.revisionId, rev };
        });
        // Distinct questions: drop repeats the random pool happened to give.
        const seen = new Set<string>();
        const unique = questions.filter((q) => (seen.has(q.questionId) ? false : (seen.add(q.questionId), true))).map((q, position) => ({ ...q, position }));

        const assignment = await prisma.assignment.create({
          data: {
            classroomId: classroom.id,
            title: plan.title,
            instructions: i === 0 ? "Work these on paper first, then enter your answers. We'll go over the hardest two in class." : null,
            dueAt: new Date(dueAt),
            createdAt: new Date(createdAt),
            questions: { create: unique.map((q) => ({ position: q.position, questionId: q.questionId, questionRevisionId: q.questionRevisionId })) },
          },
        });

        const open = dueAt > NOW;
        const sessions = [];
        const hwSlots = [];
        for (const s of roster) {
          const p = open ? 0.45 : s.engagement === "keen" ? 0.97 : s.engagement === "regular" ? 0.86 : s.engagement === "light" ? 0.6 : 0.25;
          if (!chance(p)) continue;
          const sessionId = randomUUID();
          const finishes = !open || chance(0.7);
          const startAt = createdAt + between(0.2, open ? (NOW - createdAt) / DAY - 0.1 : 8) * DAY;
          if (startAt > NOW - 10 * MINUTE) continue;
          const answeredCount = finishes ? unique.length : int(1, unique.length - 1);
          let at = startAt;
          for (const q of unique) {
            const answered = q.position < answeredCount;
            const correct = answered && answers(s.ability + 3, pick(["EASY", "MEDIUM", "HARD"] as const));
            if (answered) at += between(0.8, 2.5) * MINUTE;
            hwSlots.push({
              id: randomUUID(),
              sessionId,
              position: q.position,
              questionId: q.questionId,
              questionRevisionId: q.questionRevisionId,
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
            currentPosition: Math.min(answeredCount, unique.length - 1),
            createdAt: new Date(startAt),
            completedAt: finishes ? new Date(at + MINUTE) : null,
          });
        }
        await prisma.homeworkSession.createMany({ data: sessions });
        await chunked(hwSlots, (batch) => prisma.homeworkSlot.createMany({ data: batch }));
      }
    }
  }

  // ---- Community goal with a prize, sized so the school is about two
  // thirds of the way there with three weeks to go.
  const goalStart = new Date(NOW - 21 * DAY);
  const answeredSinceGoal =
    attempts.filter((a) => a.finalizedAt.getTime() >= goalStart.getTime()).length +
    diagnosticAttempts.filter((a) => a.submittedAt && a.submittedAt.getTime() >= goalStart.getTime()).length;
  const homeworkSince = await prisma.homeworkSlot.count({
    where: { finalizedAt: { gte: goalStart }, session: { assignment: { classroom: { schoolId: school.id } } } },
  });
  const target = Math.max(1000, Math.round((answeredSinceGoal + homeworkSince) / 0.64 / 500) * 500);
  await prisma.organization.update({
    where: { id: school.id },
    data: {
      communityGoalMetric: "QUESTIONS_ANSWERED",
      communityGoalTarget: target,
      communityGoalPrize: "Pizza party for every grade level",
      communityGoalStartsAt: goalStart,
      communityGoalEndsAt: new Date(NOW + 21 * DAY),
    },
  });

  // ---- Announcements (rows only; nothing is emailed)
  await prisma.announcement.createMany({
    data: [
      {
        organizationId: school.id,
        title: "School SAT Day is coming up",
        message: "Juniors take the SAT at school next month. Keep up your Practice Sets — we'll share the room assignments soon.",
        publishedAt: new Date(NOW - 6 * DAY),
        expiresAt: new Date(NOW + 30 * DAY),
        createdByUserId: admin.id,
      },
      {
        organizationId: school.id,
        title: "Community goal: pizza party",
        message: `If we answer ${target.toLocaleString()} questions together before the deadline, every grade gets a pizza party. Check School Community for progress.`,
        publishedAt: new Date(NOW - 20 * DAY),
        expiresAt: new Date(NOW + 21 * DAY),
        createdByUserId: admin.id,
      },
    ],
  });

  console.log(
    [
      `Created ${DISTRICT_NAME} / ${SCHOOL_NAME}.`,
      `  ${students.length} fictional students (${diagnosticSessions.filter((d) => d.status === "COMPLETED").length} finished the Diagnostic), ${practiceSets.length} Practice Sets, ${predictions.length} predictions.`,
      `  ${teachers.length} fictional teachers, ${Object.keys(homeworkPlans).length} classes with homework.`,
      `  Community goal: ${target.toLocaleString()} questions, prize set, ends in 21 days.`,
      `  Administrator: ${adminEmail} (${origin === "converted-student" ? "converted from a student account" : origin === "created" ? "new account" : "existing administrator"}) — sign in with Google using that address.`,
    ].join("\n"),
  );
}

// ---- teacher -------------------------------------------------------------------

/**
 * Gives a real account a teacher's view of the demo by handing it the seat of
 * one fictional teacher: her classes (with their fictional students and the
 * homework she set, results included) move to the real account, and her own
 * access at the campus ends, so the administrator's Teachers page shows the
 * real teacher in her place. Sign in as it with Google.
 */
async function addTeacher() {
  if (!teacherEmail || !teacherEmail.includes("@")) throw new Error("Pass the teacher's email: --teacher=you@example.org");
  const demo = await findDemo();
  const schoolId = demo?.schools[0]?.id;
  if (!demo || !schoolId) throw new Error("There's no demo district. Run `create` first.");
  const recorded = readTeacherNote(demo.internalNotes);
  if (recorded) throw new Error(`The demo already has a teacher (${recorded.email}). Run \`remove\` and \`create\` to change it.`);

  const seat = await prisma.user.findUnique({ where: { email: DEMO_TEACHER_SEAT }, select: { id: true } });
  if (!seat) throw new Error(`The fictional teacher ${DEMO_TEACHER_SEAT} isn't there to hand over.`);

  const existing = await prisma.user.findUnique({
    where: { email: teacherEmail },
    select: {
      id: true,
      role: true,
      deletedAt: true,
      studentMembership: { select: { id: true } },
      subscription: { select: { status: true } },
      classroomEnrollments: { where: { removedAt: null }, select: { id: true } },
      teacherAssignments: { where: { removedAt: null }, select: { schoolId: true } },
    },
  });
  let origin: TeacherOrigin = "created";
  if (existing) {
    if (existing.deletedAt) throw new Error(`${teacherEmail} belongs to a deleted account.`);
    if (existing.role === "TEACHER") {
      if (existing.teacherAssignments.some((a) => a.schoolId !== schoolId)) {
        throw new Error(`${teacherEmail} already teaches at another school.`);
      }
      origin = "existing-teacher";
    } else if (existing.role === "STUDENT" && convertStudent) {
      // A teacher has no student experience: a school membership would put
      // them in a school's totals, a class enrollment would put them on a
      // roster, and a live subscription would keep billing them.
      if (existing.studentMembership) throw new Error(`${teacherEmail} has a school membership; it can't become a teacher.`);
      if (existing.classroomEnrollments.length) throw new Error(`${teacherEmail} is enrolled in a class; it can't become a teacher.`);
      if (existing.subscription && existing.subscription.status === "ACTIVE") {
        throw new Error(`${teacherEmail} has an active subscription; cancel it first.`);
      }
      origin = "converted-student";
    } else {
      throw new Error(
        `${teacherEmail} already has a ${existing.role} account.` +
          (existing.role === "STUDENT" ? " Pass --convert-student to make it the teacher (remove turns it back)." : ""),
      );
    }
  }

  const classes = await prisma.$transaction(async (tx) => {
    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { role: "TEACHER" }, select: { id: true } })
      : await tx.user.create({ data: { role: "TEACHER", firstName: "Demo", email: teacherEmail, ageConfirmed: true }, select: { id: true } });
    await tx.teacherAssignment.upsert({
      where: { userId_schoolId: { userId: user.id, schoolId } },
      update: { removedAt: null },
      create: { userId: user.id, schoolId },
    });
    const moved = await tx.classroom.updateMany({ where: { teacherId: seat.id, schoolId }, data: { teacherId: user.id } });
    await tx.teacherAssignment.updateMany({ where: { userId: seat.id, schoolId }, data: { removedAt: new Date() } });
    await tx.organization.update({
      where: { id: demo.id },
      data: { internalNotes: `${demo.internalNotes ?? MARKER}\nteacher=${teacherEmail}\nteacherOrigin=${origin}` },
    });
    return moved.count;
  });

  console.log(
    `${teacherEmail} is now a teacher at ${SCHOOL_NAME} with ${classes} classes (` +
      (origin === "converted-student" ? "converted from a student account; remove turns it back" : origin === "created" ? "new account" : "existing teacher") +
      "). Sign in with Google using that address; /home goes straight to the teacher pages.",
  );
}

async function main() {
  if (command === "check") return check();
  if (command === "create") return create();
  if (command === "remove") return remove();
  if (command === "teacher") return addTeacher();
  console.log("Usage: npx tsx scripts/demo-district.ts <check|create|teacher|remove> [--admin=email] [--teacher=email]");
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
