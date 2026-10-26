/**
 * Accounts for a load test: one fictional school and N students in it, so the
 * school-wide pages (School Community, Admin Overview) do their real work over
 * a district-sized membership.
 *
 *   DATABASE_URL="<loadtest branch URL>" npx tsx scripts/load-test/seed.ts create --count=2000 --password=<choose one>
 *   DATABASE_URL="<loadtest branch URL>" npx tsx scripts/load-test/seed.ts remove
 *
 * Run it against a Neon *branch* (or the local database), never production:
 * it refuses outright when DATABASE_URL points at the same host as the
 * production URL in `.env.neon`. The password is given on the command line
 * so no usable one is ever committed. Everything lives on
 * `loadtest.example.com`, which no mail is ever sent to and which analytics
 * and lifecycle email already ignore, and `remove` deletes all of it.
 *
 * Students have finished onboarding and nothing else; the browser phase of
 * `run.mjs` gives a sample of them real Diagnostic activity.
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../../src/lib/password";

const DOMAIN = "loadtest.example.com";
const SCHOOL_NAME = "Load Test High School";
const MARKER = "load-test";
const DAY = 86_400_000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace("-pooler", "");
  } catch {
    return "";
  }
}

function refuseProduction(url: string): void {
  if (!existsSync(".env.neon")) return;
  const line = readFileSync(".env.neon", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("DATABASE_URL="));
  const production = line ? line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "") : "";
  if (production && hostOf(production) === hostOf(url)) {
    throw new Error("DATABASE_URL is the production database. Load tests run against a Neon branch.");
  }
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

async function chunked<T>(rows: T[], write: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += 1_000) await write(rows.slice(i, i + 1_000));
}

async function create(prisma: PrismaClient) {
  const count = Number(arg("count") ?? 0);
  const password = arg("password");
  if (!Number.isInteger(count) || count < 1 || count > 50_000) throw new Error("--count=<1..50000> is required");
  if (!password || password.length < 10) throw new Error("--password=<at least 10 characters> is required");
  if (await prisma.organization.findFirst({ where: { internalNotes: MARKER } })) {
    throw new Error("Load-test accounts already exist here. Run `remove` first.");
  }

  const now = Date.now();
  const school = await prisma.organization.create({
    data: {
      organizationType: "SCHOOL",
      officialName: SCHOOL_NAME,
      city: "Testville",
      state: "TX",
      schoolYear: "2026-2027",
      contractStartDate: new Date(now - 30 * DAY),
      contractEndDate: new Date(now + 300 * DAY),
      status: "ACTIVE",
      directoryVisible: false,
      totalEnrollment: count,
      internalNotes: MARKER,
    },
  });

  const passwordHash = await hashPassword(password);
  const springYear = new Date(now).getMonth() >= 7 ? new Date(now).getFullYear() + 1 : new Date(now).getFullYear();
  const users = [];
  const memberships = [];
  for (let n = 1; n <= count; n++) {
    const id = randomUUID();
    const email = `lt-${String(n).padStart(5, "0")}@${DOMAIN}`;
    const grade = 9 + (n % 4);
    users.push({
      id,
      role: "STUDENT" as const,
      firstName: `Load${n}`,
      email,
      passwordHash,
      grade,
      ageConfirmed: true,
      onboardingCompletedAt: new Date(now - DAY),
      targetScore: 1200,
      studyCommitment: "MODERATE" as const,
      dailyReminderEnabled: false,
    });
    memberships.push({
      studentId: id,
      organizationId: school.id,
      schoolId: school.id,
      verifiedSchoolEmail: email,
      currentGrade: grade,
      expectedGraduationYear: springYear + (12 - grade),
      status: "ACTIVE" as const,
      activationMethod: "ROSTER" as const,
      activatedAt: new Date(now - DAY),
      // Already celebrated, so the Premium moment doesn't cover every page the test loads.
      celebratedAt: new Date(now - DAY),
    });
  }
  await chunked(users, (batch) => prisma.user.createMany({ data: batch }));
  await chunked(memberships, (batch) => prisma.studentMembership.createMany({ data: batch }));

  const admin = await prisma.user.create({
    data: { role: "SCHOOL_ADMINISTRATOR", firstName: "LoadAdmin", email: `lt-admin@${DOMAIN}`, passwordHash, ageConfirmed: true },
  });
  await prisma.administratorAssignment.create({ data: { userId: admin.id, organizationId: school.id, scope: "SCHOOL" } });

  console.log(`Created ${SCHOOL_NAME} with ${count} students (lt-00001…lt-${String(count).padStart(5, "0")}@${DOMAIN}) and lt-admin@${DOMAIN}.`);
}

async function remove(prisma: PrismaClient) {
  const school = await prisma.organization.findFirst({ where: { internalNotes: MARKER }, select: { id: true } });
  if (school) await prisma.administratorAssignment.deleteMany({ where: { organizationId: school.id } });
  // Every row a test student created (answers, sessions, memberships) hangs
  // off the user and goes with it.
  const users = await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  if (school) await prisma.organization.delete({ where: { id: school.id } });
  console.log(`Removed ${users.count} load-test accounts${school ? " and the test school" : ""}.`);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  refuseProduction(url);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const command = process.argv[2];
    if (command === "create") await create(prisma);
    else if (command === "remove") await remove(prisma);
    else throw new Error("Usage: seed.ts create --count=N --password=... | remove");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
