-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "rushLeaderboardEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "rush_challenges" ADD COLUMN     "invitedStudentId" TEXT,
ADD COLUMN     "rematchOfId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "rushLeaderboardHidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "rush_challenges_rematchOfId_key" ON "rush_challenges"("rematchOfId");

-- CreateIndex
CREATE INDEX "rush_challenges_invitedStudentId_idx" ON "rush_challenges"("invitedStudentId");

-- AddForeignKey
ALTER TABLE "rush_challenges" ADD CONSTRAINT "rush_challenges_rematchOfId_fkey" FOREIGN KEY ("rematchOfId") REFERENCES "rush_challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rush_challenges" ADD CONSTRAINT "rush_challenges_invitedStudentId_fkey" FOREIGN KEY ("invitedStudentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

