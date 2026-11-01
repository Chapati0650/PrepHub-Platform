-- CreateEnum
CREATE TYPE "AssignmentMode" AS ENUM ('PRACTICE', 'QUIZ');

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "mode" "AssignmentMode" NOT NULL DEFAULT 'PRACTICE',
ADD COLUMN     "reminderQueuedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "classroom_enrollments" ADD COLUMN     "lastName" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "teacherDisplayName" TEXT;
