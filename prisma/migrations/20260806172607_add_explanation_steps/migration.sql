-- CreateTable
CREATE TABLE "explanation_steps" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "imageId" TEXT,

    CONSTRAINT "explanation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "explanation_steps_revisionId_order_key" ON "explanation_steps"("revisionId", "order");

-- AddForeignKey
ALTER TABLE "explanation_steps" ADD CONSTRAINT "explanation_steps_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "question_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "explanation_steps" ADD CONSTRAINT "explanation_steps_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
