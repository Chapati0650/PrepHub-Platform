-- Data-only migration: calculator access is now a fixed function of category
-- (Desmos is available throughout the digital SAT Math section, on every
-- Algebra / Geometry & Trigonometry / Advanced Math / Problem Solving & Data
-- Analysis question, and never on Reading Comprehension / Grammar /
-- Vocabulary) rather than an independent per-question choice. This corrects
-- any existing question_revisions rows so historical/seeded content matches
-- that rule going forward.
UPDATE "question_revisions" AS qr
SET "calculatorSetting" = CASE
  WHEN q."category" IN ('ALGEBRA', 'GEOMETRY_TRIGONOMETRY', 'ADVANCED_MATH', 'PROBLEM_SOLVING_DATA_ANALYSIS')
    THEN 'ALLOWED'
  ELSE 'NOT_ALLOWED'
END::"CalculatorSetting"
FROM "questions" AS q
WHERE q."id" = qr."questionId"
  AND qr."calculatorSetting" IS DISTINCT FROM (
    CASE
      WHEN q."category" IN ('ALGEBRA', 'GEOMETRY_TRIGONOMETRY', 'ADVANCED_MATH', 'PROBLEM_SOLVING_DATA_ANALYSIS')
        THEN 'ALLOWED'
      ELSE 'NOT_ALLOWED'
    END::"CalculatorSetting"
  );
