-- CreateEnum
CREATE TYPE "StudyCommitment" AS ENUM ('LIGHT', 'MODERATE', 'INTENSIVE', 'FEW_TIMES_WEEK', 'UNSURE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "studyCommitment" "StudyCommitment";

-- Backfill: existing users must never be retroactively forced into the
-- onboarding wizard added by this migration.
UPDATE "users" SET "onboardingCompletedAt" = "createdAt" WHERE "onboardingCompletedAt" IS NULL;
