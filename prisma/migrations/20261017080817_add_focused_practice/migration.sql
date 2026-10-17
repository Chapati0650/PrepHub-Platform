-- CreateEnum
CREATE TYPE "FocusedDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'MIXED');

-- CreateEnum
CREATE TYPE "FocusedSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateTable
CREATE TABLE "focused_sessions" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "category" "QuestionCategory" NOT NULL,
    "difficulty" "FocusedDifficulty" NOT NULL,
    "status" "FocusedSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "randomSeed" TEXT NOT NULL,
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "focused_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "focused_slots" (
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

    CONSTRAINT "focused_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "focused_sessions_studentId_status_idx" ON "focused_sessions"("studentId", "status");

-- CreateIndex
CREATE INDEX "focused_sessions_studentId_category_idx" ON "focused_sessions"("studentId", "category");

-- CreateIndex
CREATE INDEX "focused_slots_questionId_idx" ON "focused_slots"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "focused_slots_sessionId_position_key" ON "focused_slots"("sessionId", "position");

-- AddForeignKey
ALTER TABLE "focused_sessions" ADD CONSTRAINT "focused_sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focused_slots" ADD CONSTRAINT "focused_slots_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "focused_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focused_slots" ADD CONSTRAINT "focused_slots_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focused_slots" ADD CONSTRAINT "focused_slots_questionRevisionId_fkey" FOREIGN KEY ("questionRevisionId") REFERENCES "question_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
