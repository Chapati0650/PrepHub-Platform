-- CreateEnum
CREATE TYPE "HomeworkStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'TEACHER';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "communityGoalEndsAt" TIMESTAMP(3),
ADD COLUMN     "communityGoalPrize" TEXT,
ADD COLUMN     "communityGoalReachedAt" TIMESTAMP(3),
ADD COLUMN     "communityGoalStartsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "student_memberships" ADD COLUMN     "celebratedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "teacher_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "joinCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_enrollments" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "classroom_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "dueAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_questions" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,

    CONSTRAINT "assignment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework_sessions" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "HomeworkStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "homework_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework_slots" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,
    "draftAnswer" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "answer" TEXT,
    "isCorrect" BOOLEAN,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "homework_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_userId_createdAt_idx" ON "email_verification_tokens"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "teacher_assignments_schoolId_removedAt_idx" ON "teacher_assignments"("schoolId", "removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_assignments_userId_schoolId_key" ON "teacher_assignments"("userId", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "classrooms_joinCode_key" ON "classrooms"("joinCode");

-- CreateIndex
CREATE INDEX "classrooms_teacherId_archivedAt_idx" ON "classrooms"("teacherId", "archivedAt");

-- CreateIndex
CREATE INDEX "classrooms_schoolId_idx" ON "classrooms"("schoolId");

-- CreateIndex
CREATE INDEX "classroom_enrollments_studentId_removedAt_idx" ON "classroom_enrollments"("studentId", "removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_enrollments_classroomId_studentId_key" ON "classroom_enrollments"("classroomId", "studentId");

-- CreateIndex
CREATE INDEX "assignments_classroomId_createdAt_idx" ON "assignments"("classroomId", "createdAt");

-- CreateIndex
CREATE INDEX "assignment_questions_questionId_idx" ON "assignment_questions"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_questions_assignmentId_position_key" ON "assignment_questions"("assignmentId", "position");

-- CreateIndex
CREATE INDEX "homework_sessions_studentId_status_idx" ON "homework_sessions"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "homework_sessions_assignmentId_studentId_key" ON "homework_sessions"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "homework_slots_questionId_idx" ON "homework_slots"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "homework_slots_sessionId_position_key" ON "homework_slots"("sessionId", "position");

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_enrollments" ADD CONSTRAINT "classroom_enrollments_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_enrollments" ADD CONSTRAINT "classroom_enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_questionRevisionId_fkey" FOREIGN KEY ("questionRevisionId") REFERENCES "question_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_sessions" ADD CONSTRAINT "homework_sessions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_sessions" ADD CONSTRAINT "homework_sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_slots" ADD CONSTRAINT "homework_slots_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "homework_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_slots" ADD CONSTRAINT "homework_slots_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_slots" ADD CONSTRAINT "homework_slots_questionRevisionId_fkey" FOREIGN KEY ("questionRevisionId") REFERENCES "question_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Memberships that existed before the celebration was built have already been
-- seen by their students; only memberships created from now on get the moment.
UPDATE "student_memberships" SET "celebratedAt" = "activatedAt" WHERE "celebratedAt" IS NULL;
