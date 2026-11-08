/**
 * Seeds rows for e2e/owner-requests-2026-11-08.spec.ts against the LOCAL database and prints one JSON
 * line. Run by the spec through tsx (Playwright's loader can't import the generated Prisma client).
 *
 *   tsx e2e/fixtures/owner-requests-seed.ts <teacher|class|school|district> '<json args>'
 */
import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { hashPassword } from "../../src/lib/password";
import { generateJoinCode } from "../../src/lib/teacher/join-code";
import { CURRENT_PRIVACY_VERSION, CURRENT_TOS_VERSION } from "../../src/lib/legal";

const PASSWORD = "teacherpass123";
const legal = { create: [{ tosVersion: CURRENT_TOS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION }] };
const email = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

function seedSchool(name: string, parentDistrictId?: string) {
  return prisma.organization.create({
    data: {
      organizationType: "SCHOOL",
      officialName: name,
      city: "Testville",
      state: "TX",
      schoolYear: "2026-2027",
      contractStartDate: new Date(Date.now() - 86400_000),
      contractEndDate: new Date(Date.now() + 365 * 86400_000),
      status: "ACTIVE",
      directoryVisible: false,
      parentDistrictId,
    },
  });
}

async function seedStaff(role: "TEACHER" | "SCHOOL_ADMINISTRATOR", firstName: string, extra: Record<string, unknown> = {}) {
  const address = email();
  const user = await prisma.user.create({
    data: {
      role,
      firstName,
      email: address,
      emailVerified: new Date(),
      passwordHash: await hashPassword(PASSWORD),
      ageConfirmed: true,
      dailyReminderEnabled: false,
      legalAcceptances: legal,
      ...extra,
    },
  });
  return { id: user.id, email: address };
}

const code6 = () => generateJoinCode();

async function main() {
  const [op, raw] = process.argv.slice(2);
  const arg = JSON.parse(raw ?? "{}") as Record<string, string>;
  let result: unknown;
  if (op === "teacher") {
    const school = await seedSchool(`E2E Owner Req School ${Date.now()}`);
    const teacher = await seedStaff("TEACHER", "Elena", {
      teacherDisplayName: "Ms. Rivera",
      teacherAssignments: { create: { schoolId: school.id } },
    });
    result = { school: { id: school.id, officialName: school.officialName }, teacher };
  } else if (op === "class") {
    const c = await prisma.classroom.create({ data: { teacherId: arg.teacherId, schoolId: arg.schoolId, name: arg.name, joinCode: code6() } });
    result = { id: c.id, joinCode: c.joinCode };
  } else if (op === "school") {
    const s = await seedSchool(arg.name);
    result = { id: s.id, officialName: s.officialName };
  } else if (op === "district") {
    const district = await prisma.organization.create({
      data: {
        organizationType: "DISTRICT",
        officialName: `E2E District ${Date.now()}`,
        city: "Testville",
        state: "TX",
        schoolYear: "2026-2027",
        contractStartDate: new Date(Date.now() - 86400_000),
        contractEndDate: new Date(Date.now() + 365 * 86400_000),
        status: "ACTIVE",
        directoryVisible: false,
      },
    });
    const north = await seedSchool(`E2E North Campus ${Date.now()}`, district.id);
    const south = await seedSchool(`E2E South Campus ${Date.now()}`, district.id);
    const admin = await seedStaff("SCHOOL_ADMINISTRATOR", "Alex", {
      adminAssignments: { create: { organizationId: district.id, scope: "DISTRICT" } },
    });
    const kids: string[] = [];
    // Two students at North: fewer than 5, so its figures are withheld.
    for (let i = 0; i < 2; i++) {
      const address = email();
      const s = await prisma.user.create({
        data: { role: "STUDENT", firstName: `Kid${i}`, email: address, emailVerified: new Date(), passwordHash: await hashPassword(PASSWORD), ageConfirmed: true, legalAcceptances: legal },
      });
      kids.push(s.id);
      await prisma.studentMembership.create({
        data: { studentId: s.id, organizationId: district.id, schoolId: north.id, verifiedSchoolEmail: address, currentGrade: 11, expectedGraduationYear: 2027, status: "ACTIVE", activationMethod: "DOMAIN_MATCH", activatedAt: new Date() },
      });
    }
    // Both have answered something (a Daily Challenge), so "started practicing" is 2: withheld as "Fewer than 5".
    const question = await prisma.question.findFirstOrThrow({ where: { status: "PUBLISHED", currentPublishedRevisionId: { not: null } } });
    const challenge = await prisma.dailyChallenge.create({
      data: { day: `e2e-${Date.now()}`, questionId: question.id, questionRevisionId: question.currentPublishedRevisionId! },
    });
    for (const studentId of kids) await prisma.dailyChallengeAttempt.create({ data: { challengeId: challenge.id, studentId, answer: "A", isCorrect: false } });
    result = {
      district: { officialName: district.officialName },
      north: { id: north.id, officialName: north.officialName },
      south: { id: south.id, officialName: south.officialName },
      admin,
    };
  } else {
    throw new Error(`Unknown op ${op}`);
  }
  console.log(JSON.stringify(result));
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
