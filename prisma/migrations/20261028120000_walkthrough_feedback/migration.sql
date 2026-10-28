-- CreateTable
CREATE TABLE "walkthrough_feedback" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "confusingStep" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "walkthrough_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "walkthrough_feedback_questionId_idx" ON "walkthrough_feedback"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "walkthrough_feedback_studentId_questionRevisionId_key" ON "walkthrough_feedback"("studentId", "questionRevisionId");

-- AddForeignKey
ALTER TABLE "walkthrough_feedback" ADD CONSTRAINT "walkthrough_feedback_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "walkthrough_feedback" ADD CONSTRAINT "walkthrough_feedback_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

