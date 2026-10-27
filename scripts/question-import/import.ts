/**
 * Imports a transcribed practice test into the question bank — the website's
 * bulk upload, with Claude doing the reading instead of the DeepSeek/Anthropic
 * API. See scripts/question-import/README.md for the whole workflow.
 *
 *   npx tsx scripts/question-import/import.ts "<test folder>"            check only (default)
 *   npx tsx scripts/question-import/import.ts "<test folder>" --commit   create the questions as Drafts
 *   … --commit --publish                                                  publish them too
 *
 * The test folder holds `questions.json` (the transcription, in the shape of
 * BatchSchema below) and `pages/page-NNN.png` (render-pages.mjs). A check run
 * validates every question, looks for duplicates already in the bank, and
 * crops every figure into `figures/` so the crops can be looked at before
 * anything is written. Nothing is written to the database without --commit.
 *
 * Questions go through the same functions the CMS and the website's bulk
 * upload use (createQuestion → updateDraftContent → publishQuestion,
 * uploadImage for figures), so every rule the editor enforces applies here,
 * and each is marked AI-generated with its reasoning for the reviewer, as a
 * bulk-uploaded question is.
 *
 * Production: DATABASE_URL pointing anywhere but localhost needs
 * --production, and figures need the four R2_* variables (pass them with
 * `--env-file`), or their images would be written to this computer's disk,
 * where the live site can't see them.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { QuestionCategory, QuestionDifficulty } from "../../src/generated/prisma/enums";
import { prisma } from "../../src/lib/prisma";
import {
  createQuestion,
  deleteQuestionPermanently,
  publishQuestion,
  updateDraftContent,
} from "../../src/lib/content/questions";
import { uploadImage } from "../../src/lib/content/media";

const LETTERS = ["A", "B", "C", "D"];

const FigureSchema = z.object({
  page: z.number().int().positive(),
  /** [left, top, right, bottom] on a 0–1000 scale of the page image, as the site's transcription uses. */
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

const QuestionSchema = z.object({
  /** The test's own label, e.g. "RW1-07" (section, module, number). Used in logs and figure names. */
  ref: z.string().min(1),
  pages: z.array(z.number().int().positive()).min(1),
  questionType: z.enum(["MULTIPLE_CHOICE", "OPEN_ENDED_NUMERIC"]),
  category: z.enum(Object.values(QuestionCategory) as [QuestionCategory, ...QuestionCategory[]]),
  difficulty: z.enum(Object.values(QuestionDifficulty) as [QuestionDifficulty, ...QuestionDifficulty[]]),
  difficultyReasoning: z.string().min(1),
  passageText: z.string().min(1).nullable(),
  questionText: z.string().min(1),
  choices: z.array(z.string().min(1)).length(4).nullable(),
  correctChoiceIndex: z.number().int().min(0).max(3).nullable(),
  acceptedAnswers: z.array(z.string().min(1)),
  answerConfidence: z.enum(["high", "medium", "low"]),
  answerReasoning: z.string().min(1),
  /** What the test's own answer key says ("B", "12"), or null if it has none. */
  answerKey: z.string().nullable(),
  explanationSteps: z.array(z.string().min(1)).min(1),
  /** Index-aligned with `choices`: a note per wrong choice, null at the correct one. */
  distractorExplanations: z.array(z.string().min(1).nullable()).length(4).nullable(),
  figure: FigureSchema.nullable(),
});

const BatchSchema = z.object({
  /** A name for the test, e.g. "Bluebook Practice Test 4". Recorded on every question. */
  source: z.string().min(1),
  questions: z.array(QuestionSchema).min(1),
});

type ImportQuestion = z.infer<typeof QuestionSchema>;

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--"));
const commit = args.includes("--commit");
const publish = args.includes("--publish");
const production = args.includes("--production");

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

/** Problems that would put a wrong or broken question in front of students. Any one blocks --commit. */
function problemsWith(q: ImportQuestion): string[] {
  const problems: string[] = [];
  const texts = [q.passageText ?? "", q.questionText, ...(q.choices ?? []), ...q.explanationSteps];

  if (q.questionType === "MULTIPLE_CHOICE") {
    if (!q.choices) problems.push("multiple choice needs four choices");
    if (q.correctChoiceIndex === null) problems.push("multiple choice needs correctChoiceIndex");
    if (q.acceptedAnswers.length > 0) problems.push("acceptedAnswers is for grid-ins only");
    if (!q.distractorExplanations) problems.push("multiple choice needs distractorExplanations");
    else if (q.correctChoiceIndex !== null) {
      q.distractorExplanations.forEach((note, i) => {
        if (i === q.correctChoiceIndex && note !== null) problems.push("the correct choice must not have a distractor note");
        if (i !== q.correctChoiceIndex && note === null) problems.push(`choice ${LETTERS[i]} needs a distractor note`);
      });
    }
    if (q.answerKey && q.correctChoiceIndex !== null && q.answerKey.trim().toUpperCase() !== LETTERS[q.correctChoiceIndex]) {
      problems.push(`the test's key says ${q.answerKey}, the transcription says ${LETTERS[q.correctChoiceIndex]}`);
    }
  } else {
    if (q.choices) problems.push("a grid-in has no choices");
    if (q.correctChoiceIndex !== null) problems.push("a grid-in has no correctChoiceIndex");
    if (q.acceptedAnswers.length === 0) problems.push("a grid-in needs acceptedAnswers");
    if (q.distractorExplanations) problems.push("a grid-in has no distractor notes");
    if (q.answerKey && !q.acceptedAnswers.includes(q.answerKey.trim())) {
      problems.push(`the test's key says ${q.answerKey}, which isn't among acceptedAnswers`);
    }
  }

  for (const text of texts) {
    // Money is written \$, which is not a math delimiter (latex-text.tsx).
    const delimiters = (text.replace(/\\\$/g, "").match(/\$/g) ?? []).length;
    if (delimiters % 2 !== 0) problems.push(`unbalanced $ in: ${text.slice(0, 60)}…`);
    if ((text.match(/\[\[/g) ?? []).length !== (text.match(/\]\]/g) ?? []).length) {
      problems.push(`unbalanced [[ ]] in: ${text.slice(0, 60)}…`);
    }
  }
  if (q.figure) {
    const [left, top, right, bottom] = q.figure.box;
    if (!(left >= 0 && top >= 0 && right <= 1000 && bottom <= 1000 && right > left && bottom > top)) {
      problems.push("figure box must be [left, top, right, bottom] within 0–1000");
    }
    if (!q.pages.includes(q.figure.page)) problems.push("the figure's page isn't one of the question's pages");
  }
  return problems;
}

/** Whitespace, case and math delimiters don't make two questions different. */
function contentKey(passage: string | null, stem: string): string {
  return `${passage ?? ""} ${stem}`.toLowerCase().replace(/\$/g, "").replace(/\s+/g, " ").trim();
}

function pagePath(page: number): string {
  return path.join(folder!, "pages", `page-${String(page).padStart(3, "0")}.png`);
}

async function cropFigure(q: ImportQuestion): Promise<Buffer> {
  const figure = q.figure!;
  const image = sharp(await readFile(pagePath(figure.page)));
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error(`page ${figure.page} couldn't be read`);
  const [l, t, r, b] = figure.box;
  const left = Math.max(0, Math.floor((l / 1000) * width));
  const top = Math.max(0, Math.floor((t / 1000) * height));
  const right = Math.min(width, Math.ceil((r / 1000) * width));
  const bottom = Math.min(height, Math.ceil((b / 1000) * height));
  return image.extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
}

function reviewerNote(batch: z.infer<typeof BatchSchema>, q: ImportQuestion): string {
  return [
    `Confidence: ${q.answerConfidence}. ${q.answerReasoning}`,
    q.answerKey ? `The test's answer key says ${q.answerKey}.` : null,
    `Difficulty (${q.difficulty}): ${q.difficultyReasoning}`,
    `Imported by Claude from ${batch.source}, ${q.ref}, page ${q.pages.join("–")}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

async function main() {
  if (!folder) fail('Usage: npx tsx scripts/question-import/import.ts "<test folder>" [--commit] [--publish] [--production]');
  if (publish && !commit) fail("--publish only makes sense with --commit.");

  const databaseUrl = process.env.DATABASE_URL ?? "";
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
  if (!local && !production) fail("DATABASE_URL isn't the local database. Add --production if that is intended.");
  if (local && production) fail("--production was given, but DATABASE_URL is the local database.");

  const raw = JSON.parse(await readFile(path.join(folder, "questions.json"), "utf-8"));
  const parsed = BatchSchema.safeParse(raw);
  if (!parsed.success) {
    fail(`questions.json doesn't match the expected shape:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  const batch = parsed.data;

  const r2 = ["R2_BUCKET_NAME", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].every((k) => !!process.env[k]);
  const figures = batch.questions.filter((q) => q.figure).length;
  if (commit && !local && figures > 0 && !r2) {
    fail(`${figures} questions have figures, and the R2_* variables aren't set: their images would land on this computer, not the live site.`);
  }

  // Everything already in the bank, live or not, so a test imported twice —
  // or a question the website's own bulk upload already brought in — is
  // skipped rather than duplicated. Older bulk uploads keep the passage inside
  // the question text; contentKey makes both shapes compare equal.
  const existing = await prisma.question.findMany({
    select: {
      id: true,
      status: true,
      currentPublishedRevision: { select: { questionText: true, passageText: true } },
      currentDraftRevision: { select: { questionText: true, passageText: true } },
    },
  });
  const known = new Map<string, { id: string; status: string }>();
  for (const q of existing) {
    for (const revision of [q.currentPublishedRevision, q.currentDraftRevision]) {
      if (revision) known.set(contentKey(revision.passageText, revision.questionText), { id: q.id, status: q.status });
    }
  }

  await mkdir(path.join(folder, "figures"), { recursive: true });
  const seenInBatch = new Set<string>();
  const plan: { q: ImportQuestion; duplicateOf: string | null; problems: string[]; figure: Buffer | null }[] = [];

  for (const q of batch.questions) {
    const problems = problemsWith(q);
    const key = contentKey(q.passageText, q.questionText);
    if (seenInBatch.has(key)) problems.push("appears twice in this batch");
    seenInBatch.add(key);
    for (const page of q.pages) {
      if (!existsSync(pagePath(page))) problems.push(`pages/page-${String(page).padStart(3, "0")}.png is missing`);
    }
    let figure: Buffer | null = null;
    if (q.figure && problems.length === 0) {
      try {
        figure = await cropFigure(q);
        await writeFile(path.join(folder, "figures", `${q.ref}.png`), figure);
      } catch (err) {
        problems.push(`couldn't crop the figure: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const duplicate = known.get(key);
    plan.push({ q, duplicateOf: duplicate ? `${duplicate.id} (${duplicate.status})` : null, problems, figure });
  }

  console.log(`\n${batch.source}: ${batch.questions.length} questions, ${figures} with figures (cropped into figures/)\n`);
  for (const { q, duplicateOf, problems } of plan) {
    const answer = q.correctChoiceIndex !== null ? LETTERS[q.correctChoiceIndex] : q.acceptedAnswers.join(" or ");
    const status = problems.length ? "PROBLEM" : duplicateOf ? "skip" : "ok";
    console.log(
      `${status.padEnd(8)}${q.ref.padEnd(10)}${q.category.padEnd(31)}${q.difficulty.padEnd(8)}answer ${answer}${q.figure ? "  [figure]" : ""}${q.answerConfidence === "high" ? "" : `  (${q.answerConfidence} confidence)`}`,
    );
    if (duplicateOf) console.log(`          already in the bank as ${duplicateOf}`);
    for (const p of problems) console.log(`          - ${p}`);
  }

  const blocked = plan.filter((p) => p.problems.length > 0);
  const toCreate = plan.filter((p) => p.problems.length === 0 && !p.duplicateOf);
  console.log(
    `\n${toCreate.length} to create, ${plan.length - toCreate.length - blocked.length} already in the bank, ${blocked.length} with problems.`,
  );
  if (!commit) {
    console.log("Check only: nothing was written. Re-run with --commit to create them.");
    return;
  }
  if (blocked.length > 0) fail("Not importing anything until every problem above is fixed.");

  const log: { ref: string; questionId?: string; error?: string }[] = [];
  for (const { q, figure } of toCreate) {
    let questionId: string | null = null;
    try {
      const imageId = figure
        ? (await uploadImage({ buffer: figure, mimeType: "image/png", originalFilename: `${batch.source} ${q.ref}.png` })).id
        : null;
      const sourceImageHash = createHash("sha256").update(await readFile(pagePath(q.pages[0]))).digest("hex");
      questionId = (await createQuestion({ questionType: q.questionType, category: q.category, difficulty: q.difficulty, sourceImageHash })).id;
      await updateDraftContent(questionId, {
        passageText: q.passageText,
        questionText: q.questionText,
        questionImageId: imageId,
        ...(q.questionType === "MULTIPLE_CHOICE"
          ? {
              answerChoices: q.choices!.map((text, i) => ({
                text,
                imageId: null,
                isCorrect: i === q.correctChoiceIndex,
                distractorExplanation: q.distractorExplanations![i],
              })),
            }
          : { acceptedAnswers: q.acceptedAnswers }),
        explanationSteps: q.explanationSteps.map((text) => ({ text, imageId: null })),
        aiGenerated: true,
        aiAnswerReasoning: reviewerNote(batch, q),
      });
      if (publish) await publishQuestion(questionId);
      log.push({ ref: q.ref, questionId });
      console.log(`created ${q.ref} → ${questionId}${publish ? " (published)" : " (draft)"}`);
    } catch (err) {
      // A half-made draft would sit in the Questions table as clutter.
      if (questionId) await deleteQuestionPermanently(questionId).catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      log.push({ ref: q.ref, error: message });
      console.log(`FAILED  ${q.ref}: ${message}`);
    }
  }

  await writeFile(path.join(folder, "import-log.json"), JSON.stringify({ source: batch.source, at: new Date().toISOString(), production, results: log }, null, 2));
  const failed = log.filter((l) => l.error).length;
  console.log(`\nDone: ${log.length - failed} created${publish ? " and published" : " as Drafts"}, ${failed} failed. See import-log.json.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
