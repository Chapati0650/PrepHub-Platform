-- CreateEnum
CREATE TYPE "RushDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'MIXED');

-- CreateEnum
CREATE TYPE "RushMode" AS ENUM ('SOLO', 'FRIEND', 'RANDOM');

-- CreateEnum
CREATE TYPE "RushRunStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateTable
CREATE TABLE "rush_sets" (
    "id" TEXT NOT NULL,
    "section" "ClubSection" NOT NULL,
    "difficulty" "RushDifficulty" NOT NULL,
    "randomSeed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rush_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rush_slots" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,

    CONSTRAINT "rush_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rush_challenges" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "mode" "RushMode" NOT NULL,
    "code" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rush_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rush_runs" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "RushRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "totalMs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "rush_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rush_answers" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "servedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "answer" TEXT,
    "isCorrect" BOOLEAN,
    "elapsedMs" INTEGER,
    "points" INTEGER,

    CONSTRAINT "rush_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rush_slots_setId_position_key" ON "rush_slots"("setId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "rush_challenges_code_key" ON "rush_challenges"("code");

-- CreateIndex
CREATE INDEX "rush_challenges_mode_createdAt_idx" ON "rush_challenges"("mode", "createdAt");

-- CreateIndex
CREATE INDEX "rush_runs_studentId_status_idx" ON "rush_runs"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rush_runs_challengeId_studentId_key" ON "rush_runs"("challengeId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "rush_answers_runId_position_key" ON "rush_answers"("runId", "position");

-- AddForeignKey
ALTER TABLE "rush_slots" ADD CONSTRAINT "rush_slots_setId_fkey" FOREIGN KEY ("setId") REFERENCES "rush_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rush_slots" ADD CONSTRAINT "rush_slots_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rush_slots" ADD CONSTRAINT "rush_slots_questionRevisionId_fkey" FOREIGN KEY ("questionRevisionId") REFERENCES "question_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rush_challenges" ADD CONSTRAINT "rush_challenges_setId_fkey" FOREIGN KEY ("setId") REFERENCES "rush_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rush_challenges" ADD CONSTRAINT "rush_challenges_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rush_runs" ADD CONSTRAINT "rush_runs_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "rush_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rush_runs" ADD CONSTRAINT "rush_runs_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rush_answers" ADD CONSTRAINT "rush_answers_runId_fkey" FOREIGN KEY ("runId") REFERENCES "rush_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
