-- CreateEnum
CREATE TYPE "GuidedSessionStatus" AS ENUM ('OPEN', 'ENDED');

-- CreateEnum
CREATE TYPE "GuidedPhase" AS ENUM ('LOBBY', 'PLAN', 'EXAMPLE', 'THINK', 'TALK', 'REVOTE', 'REVEAL', 'EXPLAIN', 'OWN', 'RECAP');

-- CreateEnum
CREATE TYPE "GuidedItemKind" AS ENUM ('WARMUP', 'EXAMPLE', 'CLASS', 'TWIN');

-- CreateEnum
CREATE TYPE "GuidedConfidence" AS ENUM ('SURE', 'THINK_SO', 'GUESSING');

-- CreateEnum
CREATE TYPE "GuidedPace" AS ENUM ('TOO_FAST', 'ABOUT_RIGHT', 'TOO_SLOW');

-- CreateEnum
CREATE TYPE "ExtraTime" AS ENUM ('NONE', 'TIME_AND_HALF', 'DOUBLE');

-- AlterTable
ALTER TABLE "classroom_enrollments" ADD COLUMN     "extraTime" "ExtraTime" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "guided_sessions" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "category" "QuestionCategory" NOT NULL,
    "pickSnapshot" JSONB,
    "joinCode" TEXT NOT NULL,
    "stateKey" TEXT NOT NULL,
    "status" "GuidedSessionStatus" NOT NULL DEFAULT 'OPEN',
    "phase" "GuidedPhase" NOT NULL DEFAULT 'LOBBY',
    "position" INTEGER NOT NULL DEFAULT 0,
    "step" INTEGER NOT NULL DEFAULT 0,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "phaseStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phaseEndsAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "ownQuestionCount" INTEGER NOT NULL DEFAULT 4,
    "ownSeconds" INTEGER NOT NULL DEFAULT 420,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guided_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guided_items" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "GuidedItemKind" NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL,
    "plannedChance" DOUBLE PRECISION,
    "openedAt" TIMESTAMP(3),
    "revealedAt" TIMESTAMP(3),
    "talked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "guided_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guided_participants" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "onPaper" BOOLEAN NOT NULL DEFAULT false,
    "extraTime" "ExtraTime" NOT NULL DEFAULT 'NONE',
    "pace" "GuidedPace",
    "ownFinishedAt" TIMESTAMP(3),

    CONSTRAINT "guided_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guided_responses" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "draft" TEXT,
    "firstAnswer" TEXT,
    "firstCorrect" BOOLEAN,
    "firstAt" TIMESTAMP(3),
    "confidence" "GuidedConfidence",
    "secondAnswer" TEXT,
    "secondCorrect" BOOLEAN,
    "secondAt" TIMESTAMP(3),
    "enteredByTeacher" BOOLEAN NOT NULL DEFAULT false,
    "catchUp" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "guided_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guided_own_slots" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "bonus" BOOLEAN NOT NULL DEFAULT false,
    "questionId" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL,
    "answer" TEXT,
    "isCorrect" BOOLEAN,
    "answeredAt" TIMESTAMP(3),
    "retryAnswer" TEXT,
    "retryCorrect" BOOLEAN,

    CONSTRAINT "guided_own_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guided_sessions_joinCode_key" ON "guided_sessions"("joinCode");

-- CreateIndex
CREATE UNIQUE INDEX "guided_sessions_stateKey_key" ON "guided_sessions"("stateKey");

-- CreateIndex
CREATE INDEX "guided_sessions_classroomId_createdAt_idx" ON "guided_sessions"("classroomId", "createdAt");

-- CreateIndex
CREATE INDEX "guided_sessions_teacherId_status_idx" ON "guided_sessions"("teacherId", "status");

-- CreateIndex
CREATE INDEX "guided_items_sessionId_position_idx" ON "guided_items"("sessionId", "position");

-- CreateIndex
CREATE INDEX "guided_items_questionId_idx" ON "guided_items"("questionId");

-- CreateIndex
CREATE INDEX "guided_participants_studentId_idx" ON "guided_participants"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "guided_participants_sessionId_studentId_key" ON "guided_participants"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "guided_responses_sessionId_idx" ON "guided_responses"("sessionId");

-- CreateIndex
CREATE INDEX "guided_responses_studentId_firstAt_idx" ON "guided_responses"("studentId", "firstAt");

-- CreateIndex
CREATE UNIQUE INDEX "guided_responses_itemId_studentId_key" ON "guided_responses"("itemId", "studentId");

-- CreateIndex
CREATE INDEX "guided_own_slots_studentId_answeredAt_idx" ON "guided_own_slots"("studentId", "answeredAt");

-- CreateIndex
CREATE INDEX "guided_own_slots_questionId_idx" ON "guided_own_slots"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "guided_own_slots_sessionId_studentId_position_key" ON "guided_own_slots"("sessionId", "studentId", "position");

-- AddForeignKey
ALTER TABLE "guided_sessions" ADD CONSTRAINT "guided_sessions_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_sessions" ADD CONSTRAINT "guided_sessions_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_items" ADD CONSTRAINT "guided_items_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "guided_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_items" ADD CONSTRAINT "guided_items_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_items" ADD CONSTRAINT "guided_items_questionRevisionId_fkey" FOREIGN KEY ("questionRevisionId") REFERENCES "question_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_participants" ADD CONSTRAINT "guided_participants_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "guided_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_participants" ADD CONSTRAINT "guided_participants_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_responses" ADD CONSTRAINT "guided_responses_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "guided_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_responses" ADD CONSTRAINT "guided_responses_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "guided_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_responses" ADD CONSTRAINT "guided_responses_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_own_slots" ADD CONSTRAINT "guided_own_slots_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "guided_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_own_slots" ADD CONSTRAINT "guided_own_slots_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_own_slots" ADD CONSTRAINT "guided_own_slots_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_own_slots" ADD CONSTRAINT "guided_own_slots_questionRevisionId_fkey" FOREIGN KEY ("questionRevisionId") REFERENCES "question_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
