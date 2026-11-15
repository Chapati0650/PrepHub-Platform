-- CreateEnum
CREATE TYPE "ClassRushStatus" AS ENUM ('LOBBY', 'PLAYING', 'FINISHED');

-- CreateTable
CREATE TABLE "class_rushes" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "stateKey" TEXT NOT NULL,
    "status" "ClassRushStatus" NOT NULL DEFAULT 'LOBBY',
    "position" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "scoringVersion" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "class_rushes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_rush_players" (
    "id" TEXT NOT NULL,
    "rushId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "totalMs" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_rush_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_rush_answers" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "answer" TEXT,
    "isCorrect" BOOLEAN NOT NULL,
    "points" INTEGER NOT NULL,
    "elapsedMs" INTEGER NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_rush_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "class_rushes_stateKey_key" ON "class_rushes"("stateKey");

-- CreateIndex
CREATE INDEX "class_rushes_classroomId_status_idx" ON "class_rushes"("classroomId", "status");

-- CreateIndex
CREATE INDEX "class_rush_players_studentId_idx" ON "class_rush_players"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "class_rush_players_rushId_studentId_key" ON "class_rush_players"("rushId", "studentId");

-- CreateIndex
CREATE INDEX "class_rush_answers_studentId_answeredAt_idx" ON "class_rush_answers"("studentId", "answeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "class_rush_answers_playerId_position_key" ON "class_rush_answers"("playerId", "position");

-- AddForeignKey
ALTER TABLE "class_rushes" ADD CONSTRAINT "class_rushes_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_rushes" ADD CONSTRAINT "class_rushes_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_rushes" ADD CONSTRAINT "class_rushes_setId_fkey" FOREIGN KEY ("setId") REFERENCES "rush_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_rush_players" ADD CONSTRAINT "class_rush_players_rushId_fkey" FOREIGN KEY ("rushId") REFERENCES "class_rushes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_rush_players" ADD CONSTRAINT "class_rush_players_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_rush_answers" ADD CONSTRAINT "class_rush_answers_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "class_rush_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

