-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "sourceImageHash" TEXT;

-- CreateIndex
CREATE INDEX "questions_sourceImageHash_idx" ON "questions"("sourceImageHash");
