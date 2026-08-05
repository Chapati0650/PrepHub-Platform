-- CreateEnum
CREATE TYPE "PracticeSetStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DiagnosticStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PredictionSourceType" AS ENUM ('DIAGNOSTIC', 'ADAPTIVE_SET');

-- CreateTable
CREATE TABLE "category_states" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "category" "QuestionCategory" NOT NULL,
    "ability" DOUBLE PRECISION NOT NULL,
    "initialAbility" DOUBLE PRECISION NOT NULL,
    "adaptiveQuestionsAnswered" INTEGER NOT NULL DEFAULT 0,
    "consecutiveSetsWithoutExtraAllocation" INTEGER NOT NULL DEFAULT 0,
    "lastAbilityUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "category_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_sets" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "status" "PracticeSetStatus" NOT NULL DEFAULT 'ACTIVE',
    "engineVersion" TEXT NOT NULL,
    "randomSeed" TEXT NOT NULL,
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "practice_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_generation_snapshots" (
    "id" TEXT NOT NULL,
    "practiceSetId" TEXT NOT NULL,
    "category" "QuestionCategory" NOT NULL,
    "abilityAtGeneration" DOUBLE PRECISION NOT NULL,
    "weaknessScore" DOUBLE PRECISION NOT NULL,
    "recentStruggleScore" DOUBLE PRECISION NOT NULL,
    "focusRecencyScore" DOUBLE PRECISION NOT NULL,
    "priorityScore" DOUBLE PRECISION NOT NULL,
    "guaranteedSlotCount" INTEGER NOT NULL,
    "additionalSlotCount" INTEGER NOT NULL,

    CONSTRAINT "category_generation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blueprint_slots" (
    "id" TEXT NOT NULL,
    "practiceSetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "plannedCategory" "QuestionCategory" NOT NULL,
    "plannedDifficulty" "QuestionDifficulty" NOT NULL,
    "resolvedCategory" "QuestionCategory" NOT NULL,
    "resolvedDifficulty" "QuestionDifficulty" NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,
    "questionFamilyId" TEXT,
    "draftAnswer" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "blueprint_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finalized_attempts" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "practiceSetId" TEXT NOT NULL,
    "blueprintSlotId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "category" "QuestionCategory" NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL,
    "answer" TEXT,
    "isBlank" BOOLEAN NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "expectedProbability" DOUBLE PRECISION NOT NULL,
    "kValue" DOUBLE PRECISION NOT NULL,
    "abilityBefore" DOUBLE PRECISION NOT NULL,
    "rawAbilityChange" DOUBLE PRECISION NOT NULL,
    "appliedAbilityChange" DOUBLE PRECISION NOT NULL,
    "abilityAfter" DOUBLE PRECISION NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "engineVersion" TEXT NOT NULL,

    CONSTRAINT "finalized_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_sessions" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "DiagnosticStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "diagnostic_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_attempts" (
    "id" TEXT NOT NULL,
    "diagnosticSessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "category" "QuestionCategory" NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,
    "draftAnswer" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "answer" TEXT,
    "isBlank" BOOLEAN,
    "isCorrect" BOOLEAN,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "diagnostic_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_history_entries" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sourceType" "PredictionSourceType" NOT NULL,
    "sourceSetId" TEXT,
    "readingWritingAbility" DOUBLE PRECISION,
    "mathAbility" DOUBLE PRECISION,
    "overallAbility" DOUBLE PRECISION,
    "internalDiagnosticEstimate" DOUBLE PRECISION,
    "displayedRangeIndex" INTEGER NOT NULL,
    "displayedRangeMinimum" INTEGER NOT NULL,
    "displayedRangeMaximum" INTEGER NOT NULL,
    "representativeMidpoint" INTEGER NOT NULL,
    "approximateImprovement" INTEGER NOT NULL,
    "withinRangeProgress" DOUBLE PRECISION NOT NULL,
    "scoringEngineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_history_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_states_studentId_category_key" ON "category_states"("studentId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "practice_sets_studentId_setNumber_key" ON "practice_sets"("studentId", "setNumber");

-- CreateIndex
CREATE UNIQUE INDEX "category_generation_snapshots_practiceSetId_category_key" ON "category_generation_snapshots"("practiceSetId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "blueprint_slots_practiceSetId_position_key" ON "blueprint_slots"("practiceSetId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "finalized_attempts_blueprintSlotId_key" ON "finalized_attempts"("blueprintSlotId");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_sessions_studentId_key" ON "diagnostic_sessions"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_attempts_diagnosticSessionId_position_key" ON "diagnostic_attempts"("diagnosticSessionId", "position");

-- AddForeignKey
ALTER TABLE "category_states" ADD CONSTRAINT "category_states_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sets" ADD CONSTRAINT "practice_sets_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_generation_snapshots" ADD CONSTRAINT "category_generation_snapshots_practiceSetId_fkey" FOREIGN KEY ("practiceSetId") REFERENCES "practice_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blueprint_slots" ADD CONSTRAINT "blueprint_slots_practiceSetId_fkey" FOREIGN KEY ("practiceSetId") REFERENCES "practice_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blueprint_slots" ADD CONSTRAINT "blueprint_slots_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blueprint_slots" ADD CONSTRAINT "blueprint_slots_questionRevisionId_fkey" FOREIGN KEY ("questionRevisionId") REFERENCES "question_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blueprint_slots" ADD CONSTRAINT "blueprint_slots_questionFamilyId_fkey" FOREIGN KEY ("questionFamilyId") REFERENCES "question_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finalized_attempts" ADD CONSTRAINT "finalized_attempts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finalized_attempts" ADD CONSTRAINT "finalized_attempts_practiceSetId_fkey" FOREIGN KEY ("practiceSetId") REFERENCES "practice_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finalized_attempts" ADD CONSTRAINT "finalized_attempts_blueprintSlotId_fkey" FOREIGN KEY ("blueprintSlotId") REFERENCES "blueprint_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finalized_attempts" ADD CONSTRAINT "finalized_attempts_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_attempts" ADD CONSTRAINT "diagnostic_attempts_diagnosticSessionId_fkey" FOREIGN KEY ("diagnosticSessionId") REFERENCES "diagnostic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_attempts" ADD CONSTRAINT "diagnostic_attempts_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_attempts" ADD CONSTRAINT "diagnostic_attempts_questionRevisionId_fkey" FOREIGN KEY ("questionRevisionId") REFERENCES "question_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_history_entries" ADD CONSTRAINT "prediction_history_entries_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_history_entries" ADD CONSTRAINT "prediction_history_entries_sourceSetId_fkey" FOREIGN KEY ("sourceSetId") REFERENCES "practice_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
