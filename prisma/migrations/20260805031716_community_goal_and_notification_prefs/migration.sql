-- CreateEnum
CREATE TYPE "CommunityGoalMetric" AS ENUM ('QUESTIONS_ANSWERED', 'STUDY_HOURS', 'ADAPTIVE_SESSIONS');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "communityGoalMetric" "CommunityGoalMetric",
ADD COLUMN     "communityGoalTarget" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dailyReminderEnabled" BOOLEAN NOT NULL DEFAULT true;
