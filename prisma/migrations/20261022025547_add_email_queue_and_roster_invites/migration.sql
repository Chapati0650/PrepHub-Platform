-- AlterTable
ALTER TABLE "school_roster_entries" ADD COLUMN     "inviteCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "invitedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "queued_emails" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queued_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "queued_emails_sentAt_createdAt_idx" ON "queued_emails"("sentAt", "createdAt");
