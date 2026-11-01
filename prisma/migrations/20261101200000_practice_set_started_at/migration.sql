-- When a Practice Set was first opened, so its study time stops counting the
-- days it sat generated and unopened.
ALTER TABLE "practice_sets" ADD COLUMN "startedAt" TIMESTAMP(3);

-- Earlier sets: their first answer is the closest record of when they began.
UPDATE "practice_sets" ps
   SET "startedAt" = first."at"
  FROM (SELECT "practiceSetId", MIN("finalizedAt") AS "at" FROM "finalized_attempts" GROUP BY "practiceSetId") first
 WHERE first."practiceSetId" = ps."id" AND ps."startedAt" IS NULL;
