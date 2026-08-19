-- AlterTable
ALTER TABLE "question_revisions" ADD COLUMN     "aiAnswerReasoning" TEXT,
ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiReviewedAt" TIMESTAMP(3);
