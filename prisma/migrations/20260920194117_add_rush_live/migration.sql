-- CreateEnum
CREATE TYPE "RushLiveStatus" AS ENUM ('WAITING', 'COUNTDOWN', 'PLAYING', 'FINISHED');

-- AlterTable
ALTER TABLE "rush_challenges" ADD COLUMN     "live" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "livePosition" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "livePositionStartedAt" TIMESTAMP(3),
ADD COLUMN     "liveStartsAt" TIMESTAMP(3),
ADD COLUMN     "liveStatus" "RushLiveStatus";

-- AlterTable
ALTER TABLE "rush_runs" ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "rush_challenges_live_liveStatus_idx" ON "rush_challenges"("live", "liveStatus");
