// Sample organizations for local development and e2e testing of PRD-002
// (District Verification) and the Owner-facing org tooling that comes later.
// Safe to re-run — upserts by name rather than duplicating rows.
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const now = new Date();
const oneYearAgo = new Date(now);
oneYearAgo.setFullYear(now.getFullYear() - 1);
const oneYearFromNow = new Date(now);
oneYearFromNow.setFullYear(now.getFullYear() + 1);

async function main() {
  // District with two schools — exercises the "select your school" step (§10).
  let friscoIsd = await prisma.organization.findFirst({
    where: { officialName: "Frisco ISD" },
  });
  if (!friscoIsd) {
    friscoIsd = await prisma.organization.create({
      data: {
        organizationType: "DISTRICT",
        officialName: "Frisco ISD",
        city: "Frisco",
        state: "TX",
        schoolYear: "2025-2026",
        contractStartDate: oneYearAgo,
        contractEndDate: oneYearFromNow,
        status: "ACTIVE",
        directoryVisible: true,
      },
    });
  }

  await prisma.organizationDomain.upsert({
    where: { domain: "k12.friscoisd.org" },
    update: { organizationId: friscoIsd.id, isActive: true },
    create: { organizationId: friscoIsd.id, domain: "k12.friscoisd.org", isActive: true },
  });

  for (const name of ["Frisco High School", "Independence High School"]) {
    const existing = await prisma.organization.findFirst({ where: { officialName: name } });
    if (!existing) {
      await prisma.organization.create({
        data: {
          organizationType: "SCHOOL",
          officialName: name,
          city: "Frisco",
          state: "TX",
          schoolYear: "2025-2026",
          contractStartDate: oneYearAgo,
          contractEndDate: oneYearFromNow,
          status: "ACTIVE",
          directoryVisible: true,
          parentDistrictId: friscoIsd.id,
        },
      });
    }
  }

  // Standalone school (no parent district) — exercises the direct, no-selection path.
  let planoAcademy = await prisma.organization.findFirst({
    where: { officialName: "Plano Academy" },
  });
  if (!planoAcademy) {
    planoAcademy = await prisma.organization.create({
      data: {
        organizationType: "SCHOOL",
        officialName: "Plano Academy",
        city: "Plano",
        state: "TX",
        schoolYear: "2025-2026",
        contractStartDate: oneYearAgo,
        contractEndDate: oneYearFromNow,
        status: "ACTIVE",
        directoryVisible: true,
      },
    });
  }
  await prisma.organizationDomain.upsert({
    where: { domain: "planoacademy.edu" },
    update: { organizationId: planoAcademy.id, isActive: true },
    create: { organizationId: planoAcademy.id, domain: "planoacademy.edu", isActive: true },
  });

  // Known-but-not-partnered district — appears in the directory as "unavailable"
  // (§6.6) without granting access; deliberately has no approved domain.
  const lewisvilleIsd = await prisma.organization.findFirst({
    where: { officialName: "Lewisville ISD" },
  });
  if (!lewisvilleIsd) {
    await prisma.organization.create({
      data: {
        organizationType: "DISTRICT",
        officialName: "Lewisville ISD",
        city: "Lewisville",
        state: "TX",
        schoolYear: "2025-2026",
        contractStartDate: oneYearAgo,
        contractEndDate: oneYearAgo,
        status: "SETUP",
        directoryVisible: true,
      },
    });
  }

  // PrepHub is single-owner (CLAUDE.md) — there's no signup flow for OWNER,
  // by design. This is the one and only place that account gets provisioned.
  const ownerEmail = process.env.OWNER_EMAIL ?? "owner@prephub.dev";
  const existingOwner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!existingOwner) {
    const ownerPassword = process.env.OWNER_PASSWORD ?? "dev-owner-password-change-me";
    await prisma.user.create({
      data: {
        role: "OWNER",
        firstName: "Owner",
        email: ownerEmail,
        passwordHash: await hashPassword(ownerPassword),
        ageConfirmed: true,
      },
    });
    console.log(`Owner account created: ${ownerEmail} / ${ownerPassword}`);
  }

  await seedQuestionBank();

  console.log("Seed complete.");
}

// PRD-012/014 need real published content across every (category, difficulty)
// pair to generate a diagnostic or an adaptive practice set. Creating that
// through the Owner CMS UI would require uploading a real video per question
// (168+ questions), so this seeds directly via Prisma — the same
// bypass-the-UI pattern already used above for Organization fixtures.
// Skips categories/difficulties that already have enough content, so
// repeated `prisma db seed` runs don't keep accumulating duplicates.
const CATEGORIES = [
  "READING_COMPREHENSION",
  "GRAMMAR",
  "VOCABULARY",
  "ALGEBRA",
  "GEOMETRY_TRIGONOMETRY",
  "ADVANCED_MATH",
  "PROBLEM_SOLVING_DATA_ANALYSIS",
] as const;
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
const QUESTIONS_PER_COMBO = 6;
const SUGGESTED_TIME: Record<(typeof DIFFICULTIES)[number], number> = { EASY: 45, MEDIUM: 60, HARD: 90 };
const CALCULATOR_ALLOWED_CATEGORIES = new Set(["ALGEBRA", "GEOMETRY_TRIGONOMETRY", "ADVANCED_MATH", "PROBLEM_SOLVING_DATA_ANALYSIS"]);

async function seedQuestionBank() {
  for (const category of CATEGORIES) {
    for (const difficulty of DIFFICULTIES) {
      const existing = await prisma.question.count({ where: { category, difficulty, status: "PUBLISHED" } });
      if (existing >= QUESTIONS_PER_COMBO) continue;

      for (let i = existing; i < QUESTIONS_PER_COMBO; i++) {
        const questionText = `[Seed] ${category} ${difficulty} question ${i + 1}: which choice is correct?`;
        const correctIndex = i % 4;
        const now = new Date();

        await prisma.$transaction(async (tx) => {
          const question = await tx.question.create({
            data: { questionType: "MULTIPLE_CHOICE", category, difficulty, status: "DRAFT" },
          });
          const revision = await tx.questionRevision.create({
            data: {
              questionId: question.id,
              questionText,
              calculatorSetting: CALCULATOR_ALLOWED_CATEGORIES.has(category) ? "ALLOWED" : "NOT_ALLOWED",
              suggestedTimeSeconds: SUGGESTED_TIME[difficulty],
              writtenExplanation: `Choice ${correctIndex + 1} is correct because this is seeded practice content.`,
              previewCompletedAt: now,
              publishedAt: now,
              answerChoices: {
                create: Array.from({ length: 4 }, (_, order) => ({
                  order,
                  text: `Choice ${order + 1}`,
                  isCorrect: order === correctIndex,
                })),
              },
            },
          });
          await tx.question.update({
            where: { id: question.id },
            data: { status: "PUBLISHED", currentPublishedRevisionId: revision.id, publishedAt: now },
          });
        });
      }
    }
  }
  console.log(`Question bank seeded: ${QUESTIONS_PER_COMBO} published questions per (category, difficulty).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
