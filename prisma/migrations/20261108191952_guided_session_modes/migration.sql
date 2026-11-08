-- CreateEnum
CREATE TYPE "GuidedSessionMode" AS ENUM ('TEACHER_LED', 'INDIVIDUAL');

-- AlterTable
ALTER TABLE "guided_sessions" ADD COLUMN     "mode" "GuidedSessionMode" NOT NULL DEFAULT 'TEACHER_LED',
ADD COLUMN     "perStudentSkills" BOOLEAN NOT NULL DEFAULT false;
