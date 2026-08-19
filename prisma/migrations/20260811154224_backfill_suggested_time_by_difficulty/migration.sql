-- Data-only migration: suggested time is now a fixed function of difficulty
-- (Easy 60s, Medium 90s, Hard 180s) rather than an Owner-editable per-question
-- value. Corrects any existing question_revisions rows so historical/seeded
-- content matches that rule going forward, same as the earlier calculator-
-- setting backfill.
UPDATE "question_revisions" AS qr
SET "suggestedTimeSeconds" = CASE q."difficulty"
  WHEN 'EASY' THEN 60
  WHEN 'MEDIUM' THEN 90
  WHEN 'HARD' THEN 180
END
FROM "questions" AS q
WHERE q."id" = qr."questionId"
  AND qr."suggestedTimeSeconds" IS DISTINCT FROM (
    CASE q."difficulty"
      WHEN 'EASY' THEN 60
      WHEN 'MEDIUM' THEN 90
      WHEN 'HARD' THEN 180
    END
  );
