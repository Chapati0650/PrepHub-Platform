-- A question revision's explanation as a step-through visual (src/lib/content/walkthrough.ts).
ALTER TABLE "question_revisions" ADD COLUMN "walkthrough" JSONB;
