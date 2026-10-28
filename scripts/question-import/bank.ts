/**
 * Walkthroughs for questions already in the bank (2026-10-27).
 *
 * The import (import.ts) writes walkthroughs as a test is brought in. This
 * does the same for the questions that came before it, in batches:
 *
 *   npx tsx scripts/question-import/bank.ts export "<batch folder>" [--per-category=N] [--limit=N] [--section=rw|math] [--ids=a,b] [--production]
 *       Read-only. Writes batch.json (each question as students see it, with
 *       its explanation and distractor notes) and figures/<id>.png. Skips
 *       questions that already have a walkthrough, and any question already
 *       in another batch folder beside this one.
 *   npx tsx scripts/question-import/bank.ts check "<batch folder>" [--only=<id>]
 *       Offline: checks walkthroughs.json against batch.json with the site's
 *       own validator, and shows which highlighted words each narration will
 *       colour. No database.
 *   npx tsx scripts/question-import/bank.ts mirror "<batch folder>"
 *       Local database only: creates the batch's questions locally, published,
 *       so a batch can be looked at in a real browser before it goes live.
 *       Records the local ids in mirror-log.json.
 *   npx tsx scripts/question-import/bank.ts apply "<batch folder>" [--local] [--commit] [--production]
 *       Writes each walkthrough (and a rewritten explanation, when the entry
 *       has explanationSteps) to its question: --local to the mirrored copies,
 *       otherwise to the questions the batch was exported from. Without
 *       --commit it only reports what it would do.
 *
 * walkthroughs.json is keyed by question id: { "<id>": { "explanationSteps"?:
 * string[], "walkthrough": {...} } }. explanationSteps is given only when the
 * explanation itself is rewritten (a skipped formula stated, the six with no
 * explanation written); the walkthrough then has one step per new step. The
 * authoring rules are the README's "Explanations" and "Walkthroughs".
 *
 * A rewritten explanation is saved through updateDraftContent, exactly as an
 * edit in the CMS; a walkthrough alone is written onto the live revision, as
 * import.ts --attach-walkthroughs does (it is presentation of the explanation,
 * checked against that revision's content). Either way the question must
 * still read as it did when exported, or it is skipped.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../src/lib/prisma";
import { createQuestion, publishQuestion, updateDraftContent } from "../../src/lib/content/questions";
import { uploadImage } from "../../src/lib/content/media";
import { readFromStorage } from "../../src/lib/content/storage";
import { markNarration, promptAt, type Walkthrough } from "../../src/lib/content/walkthrough";
import { lintWalkthrough, validateWalkthrough, walkthroughViewFor } from "../../src/lib/content/walkthrough-validate";
import { splitStoredPassage, stripStepPrefix } from "../../src/lib/content/legacy-text";
import type { Prisma } from "../../src/generated/prisma/client";
import type { QuestionCategory, QuestionDifficulty, QuestionType } from "../../src/generated/prisma/enums";

type BankQuestion = {
  id: string;
  /**
   * Set when the passage was stored inside the question text (older bulk
   * uploads put the stem, a blank line, then the passage, in one field). The
   * export splits it into passageText and questionText, word for word, so a
   * walkthrough can highlight the passage and the session shows it beside
   * the question; apply writes the split. This is the text as stored.
   */
  originalQuestionText?: string;
  /** The explanation as stored, when it differs from explanationSteps (a "Step 3:" prefix stripped). */
  storedExplanationSteps?: string[];
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  questionType: QuestionType;
  passageText: string | null;
  questionText: string;
  choices: string[];
  correctChoiceIndex: number | null;
  acceptedAnswers: string[];
  explanationSteps: string[];
  distractorExplanations: (string | null)[];
  figure: string | null;
  choiceImages: boolean;
};
type Batch = { exportedAt: string; production: boolean; questions: BankQuestion[] };
/**
 * keyFix corrects a wrong answer key found while writing the walkthrough (the
 * figure says otherwise). It is written only with apply --fix-keys, which the
 * Owner approves per batch: changing a live question's correct answer is a
 * different order of change from rewording its explanation.
 */
type KeyFix = {
  correctChoiceIndex?: number;
  acceptedAnswers?: string[];
  distractorExplanations?: (string | null)[];
  why: string;
};
type Entry = { explanationSteps?: string[]; walkthrough: Walkthrough; keyFix?: KeyFix };

/** The question's key as the walkthrough should be checked against: the stored one, or the fix. */
function keyOf(q: BankQuestion, entry: Entry) {
  return {
    correctChoiceIndex: entry.keyFix?.correctChoiceIndex ?? q.correctChoiceIndex,
    acceptedAnswers: entry.keyFix?.acceptedAnswers ?? q.acceptedAnswers,
    distractorExplanations: entry.keyFix?.distractorExplanations ?? q.distractorExplanations,
  };
}

const [command, folder] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const flag = (name: string) => flags.some((f) => f === `--${name}` || f.startsWith(`--${name}=`));
const value = (name: string) => flags.find((f) => f.startsWith(`--${name}=`))?.split("=")[1];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function databaseGuard() {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "");
  if (!local && !flag("production")) fail("DATABASE_URL isn't the local database. Add --production if that is intended.");
  if (local && flag("production")) fail("--production was given, but DATABASE_URL is the local database.");
  return local;
}

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, "utf-8")) as T;
const sameText = (a: string | null, b: string | null) => (a ?? "").trim() === (b ?? "").trim();

const READING_AND_WRITING = new Set(["READING_COMPREHENSION", "GRAMMAR", "VOCABULARY"]);

async function exportBatch() {
  databaseGuard();
  const exclude = new Set<string>();
  const parent = path.dirname(path.resolve(folder));
  for (const sibling of existsSync(parent) ? readdirSync(parent) : []) {
    const file = path.join(parent, sibling, "batch.json");
    if (path.join(parent, sibling) === path.resolve(folder) || !existsSync(file)) continue;
    for (const q of (await readJson<Batch>(file)).questions) exclude.add(q.id);
  }
  const ids = value("ids")?.split(",");
  const perCategory = Number(value("per-category") ?? Infinity);
  const limit = Number(value("limit") ?? Infinity);
  const section = value("section");
  if (section && section !== "rw" && section !== "math") fail("--section is rw or math");

  const rows = await prisma.question.findMany({
    where: { status: "PUBLISHED", ...(ids ? { id: { in: ids } } : {}) },
    orderBy: { createdAt: "asc" },
    include: {
      currentPublishedRevision: {
        include: {
          answerChoices: { orderBy: { order: "asc" } },
          explanationSteps: { orderBy: { order: "asc" } },
          questionImage: true,
        },
      },
    },
  });
  const counts = new Map<string, number>();
  const picked: typeof rows = [];
  for (const row of rows) {
    const revision = row.currentPublishedRevision;
    if (!revision || (!ids && (revision.walkthrough !== null || exclude.has(row.id)))) continue;
    if (section && READING_AND_WRITING.has(row.category) !== (section === "rw")) continue;
    if ((counts.get(row.category) ?? 0) >= perCategory || picked.length >= limit) continue;
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    picked.push(row);
  }

  await mkdir(path.join(folder, "figures"), { recursive: true });
  const questions: BankQuestion[] = [];
  const missingFigures: string[] = [];
  for (const row of picked) {
    const revision = row.currentPublishedRevision!;
    let figure: string | null = null;
    if (revision.questionImage) {
      try {
        const bytes = await readFromStorage(revision.questionImage.storageKey);
        figure = `figures/${row.id}.png`;
        await writeFile(path.join(folder, figure), bytes);
      } catch (err) {
        // Left out rather than written blind: a walkthrough that redraws a
        // figure has to see it.
        console.log(`  ${row.id}: its figure (${revision.questionImage.storageKey}) couldn't be read: ${err instanceof Error ? err.message : err}`);
        missingFigures.push(row.id);
        continue;
      }
    }
    const correct = revision.answerChoices.findIndex((c) => c.isCorrect);
    const split =
      READING_AND_WRITING.has(row.category) && !(revision.passageText ?? "").trim() ? splitStoredPassage(revision.questionText) : null;
    questions.push({
      id: row.id,
      ...(split ? { originalQuestionText: revision.questionText } : {}),
      category: row.category,
      difficulty: row.difficulty,
      questionType: row.questionType,
      passageText: split ? split.passageText : revision.passageText,
      questionText: split ? split.questionText : revision.questionText,
      choices: revision.answerChoices.map((c) => c.text),
      correctChoiceIndex: correct === -1 ? null : correct,
      acceptedAnswers: revision.acceptedAnswers,
      // Prefixes are stripped here, so a walkthrough's narration never says
      // "Step 3:" under the site's own "Step 3"; apply saves the stripped text.
      explanationSteps: revision.explanationSteps.map((s) => stripStepPrefix(s.text)),
      ...(revision.explanationSteps.some((s) => stripStepPrefix(s.text) !== s.text)
        ? { storedExplanationSteps: revision.explanationSteps.map((s) => s.text) }
        : {}),
      distractorExplanations: revision.answerChoices.map((c) => c.distractorExplanation),
      figure,
      choiceImages: revision.answerChoices.some((c) => c.imageId),
    });
  }
  const batch: Batch = { exportedAt: new Date().toISOString(), production: flag("production"), questions };
  await writeFile(path.join(folder, "batch.json"), JSON.stringify(batch, null, 2) + "\n");
  console.log(`Exported ${questions.length} question(s), ${questions.filter((q) => q.figure).length} with figures, to ${folder}`);
  const splits = questions.filter((q) => q.originalQuestionText).length;
  if (splits) console.log(`${splits} had the passage inside the question text; split into passage + question`);
  if (missingFigures.length) console.log(`Left out ${missingFigures.length} whose figure couldn't be read: ${missingFigures.join(", ")}`);
  for (const [category, n] of counts) console.log(`  ${category}: ${n}`);
}

async function check() {
  const batch = await readJson<Batch>(path.join(folder, "batch.json"));
  const entries = await readJson<Record<string, Entry>>(path.join(folder, "walkthroughs.json"));
  let bad = 0;
  const only = value("only");
  for (const q of batch.questions) {
    if (only && q.id !== only) continue;
    const entry = entries[q.id];
    if (!entry) {
      console.log(`\n== ${q.id} (${q.category}): MISSING`);
      bad++;
      continue;
    }
    const steps = entry.explanationSteps ?? q.explanationSteps;
    const key = keyOf(q, entry);
    if (entry.keyFix) {
      const was = q.correctChoiceIndex !== null ? `choice ${"ABCD"[q.correctChoiceIndex]}` : q.acceptedAnswers.join(" or ");
      const now = key.correctChoiceIndex !== null ? `choice ${"ABCD"[key.correctChoiceIndex]}` : key.acceptedAnswers.join(" or ");
      console.log(`\n!! ${q.id}: ANSWER KEY CHANGE ${was} → ${now} (needs --fix-keys): ${entry.keyFix.why}`);
    }
    const result = validateWalkthrough(entry.walkthrough, {
      passageText: q.passageText,
      choiceCount: q.choices.length,
      correctIndex: key.correctChoiceIndex,
      stepCount: steps.length,
    });
    const notes = [entry.explanationSteps ? `explanation rewritten ${q.explanationSteps.length} → ${steps.length}` : "", entry.walkthrough?.takeaway ? "" : "no takeaway", entry.walkthrough?.prompts?.length ? "" : "no prompt"].filter(Boolean);
    console.log(`\n== ${q.id} (${q.category} ${q.difficulty}): ${result.ok ? "ok" : "PROBLEMS"}${notes.length ? `  [${notes.join(", ")}]` : ""}`);
    if (!result.ok) {
      bad++;
      for (const p of result.problems) console.log(`   - ${p}`);
      continue;
    }
    if (!entry.walkthrough.takeaway || !entry.walkthrough.prompts?.length) bad++;
    // Advice, not errors: a walkthrough can go live with these, but is better without.
    for (const advice of lintWalkthrough(result.spec)) console.log(`   ~ ${advice}`);
    const passageId = entry.walkthrough.panels.find((p) => p.type === "passage")?.id ?? "passage";
    entry.walkthrough.steps.forEach((step, i) => {
      const prompt = promptAt(entry.walkthrough, i);
      if (prompt) console.log(`   step ${i + 1} PROMPT: ${prompt.ask}`);
      const marks = step[passageId] as { highlight?: string[]; alt?: string[] } | undefined;
      if (!marks?.highlight?.length && !marks?.alt?.length) return;
      const shown = markNarration(steps[i], marks.highlight ?? [], marks.alt ?? [])
        .replace(//g, "[")
        .replace(//g, "]")
        .replace(//g, "{")
        .replace(//g, "}");
      console.log(`   step ${i + 1} narration ${shown}`);
    });
  }
  const extra = only ? [] : Object.keys(entries).filter((id) => !batch.questions.some((q) => q.id === id));
  for (const id of extra) console.log(`\n${id}: in walkthroughs.json but not in this batch`);
  console.log(`\n${bad === 0 && extra.length === 0 ? "all valid" : `${bad + extra.length} to fix`}`);
}

async function mirror() {
  if (!databaseGuard()) fail("mirror only writes to the local database.");
  const batch = await readJson<Batch>(path.join(folder, "batch.json"));
  const logFile = path.join(folder, "mirror-log.json");
  const log: Record<string, string> = existsSync(logFile) ? await readJson(logFile) : {};
  for (const q of batch.questions) {
    if (log[q.id] && (await prisma.question.findUnique({ where: { id: log[q.id] } }))) continue;
    const imageId = q.figure
      ? (await uploadImage({ buffer: await readFile(path.join(folder, q.figure)), mimeType: "image/png", originalFilename: `${q.id}.png` })).id
      : null;
    const sourceImageHash = createHash("sha256").update(`bank:${q.id}`).digest("hex");
    const id = (await createQuestion({ questionType: q.questionType, category: q.category, difficulty: q.difficulty, sourceImageHash })).id;
    // The local copy is made as the question is stored live (unsplit), so
    // apply --local repeats exactly what apply will do there.
    await updateDraftContent(id, {
      passageText: q.originalQuestionText ? null : q.passageText,
      questionText: q.originalQuestionText ?? q.questionText,
      questionImageId: imageId,
      ...(q.questionType === "MULTIPLE_CHOICE"
        ? {
            answerChoices: q.choices.map((text, i) => ({
              text,
              imageId: null,
              isCorrect: i === q.correctChoiceIndex,
              distractorExplanation: q.distractorExplanations[i],
            })),
          }
        : { acceptedAnswers: q.acceptedAnswers }),
      explanationSteps: (q.storedExplanationSteps ?? q.explanationSteps).map((text) => ({ text, imageId: null })),
      aiGenerated: true,
    });
    await publishQuestion(id);
    log[q.id] = id;
    console.log(`mirrored ${q.id} → ${id}`);
  }
  await writeFile(logFile, JSON.stringify(log, null, 2) + "\n");
  console.log(`${Object.keys(log).length} mirrored locally; ids in mirror-log.json`);
}

async function apply() {
  const local = databaseGuard();
  const toMirror = flag("local");
  if (toMirror && !local) fail("--local writes to the mirrored copies in the local database.");
  if (!toMirror && local !== !(await readJson<Batch>(path.join(folder, "batch.json"))).production) {
    fail("This batch was exported from the other database; use --local for the mirrored copies.");
  }
  const commit = flag("commit");
  const batch = await readJson<Batch>(path.join(folder, "batch.json"));
  const entries = await readJson<Record<string, Entry>>(path.join(folder, "walkthroughs.json"));
  const mirrorLog: Record<string, string> = toMirror ? await readJson(path.join(folder, "mirror-log.json")) : {};
  let written = 0;
  let skipped = 0;

  for (const q of batch.questions) {
    const entry = entries[q.id];
    const targetId = toMirror ? mirrorLog[q.id] : q.id;
    if (!entry || !targetId) {
      console.log(`skip ${q.id}: ${!entry ? "no walkthrough written" : "not mirrored"}`);
      skipped++;
      continue;
    }
    const question = await prisma.question.findUnique({
      where: { id: targetId },
      include: {
        currentPublishedRevision: { include: { answerChoices: { orderBy: { order: "asc" } }, explanationSteps: { orderBy: { order: "asc" } } } },
        currentDraftRevision: { include: { answerChoices: { orderBy: { order: "asc" } }, explanationSteps: { orderBy: { order: "asc" } } } },
      },
    });
    const revision = question?.currentDraftRevision ?? question?.currentPublishedRevision;
    if (!question || !revision || question.status === "ARCHIVED") {
      console.log(`skip ${q.id}: no longer in the bank`);
      skipped++;
      continue;
    }
    // Written against the question as exported; if the Owner has changed it
    // since, the walkthrough may no longer fit, so it waits for a re-export.
    const stored = revision.explanationSteps.map((s) => s.text);
    const exportedStored = q.storedExplanationSteps ?? q.explanationSteps;
    const split = q.originalQuestionText !== undefined;
    const unchanged =
      sameText(revision.passageText, split ? null : q.passageText) &&
      sameText(revision.questionText, q.originalQuestionText ?? q.questionText) &&
      revision.answerChoices.length === q.choices.length &&
      revision.answerChoices.every((c, i) => sameText(c.text, q.choices[i])) &&
      stored.length === exportedStored.length &&
      stored.every((s, i) => sameText(s, exportedStored[i]));
    if (!unchanged) {
      console.log(`skip ${q.id}: changed since it was exported; export it again`);
      skipped++;
      continue;
    }
    const steps = entry.explanationSteps ?? q.explanationSteps;
    if (entry.keyFix && !flag("fix-keys")) {
      console.log(`skip ${q.id}: carries an answer key fix (${entry.keyFix.why}); apply with --fix-keys once the Owner has approved it`);
      skipped++;
      continue;
    }
    const key = keyOf(q, entry);
    const choices = revision.answerChoices.map((c, i) => ({
      ...c,
      isCorrect: key.correctChoiceIndex === null ? c.isCorrect : i === key.correctChoiceIndex,
    }));
    const { view, problems } = walkthroughViewFor({
      walkthrough: entry.walkthrough,
      passageText: split ? q.passageText : revision.passageText,
      answerChoices: choices,
      explanationStepCount: steps.length,
    });
    if (!view) {
      console.log(`REFUSED ${q.id}: ${problems.join("; ")}`);
      skipped++;
      continue;
    }
    const rewriting = steps.length !== stored.length || steps.some((s, i) => s !== stored[i]);
    const fixingKey = !!entry.keyFix;
    if ((rewriting || split || fixingKey) && (question.familyId || revision.explanationSteps.some((s) => s.imageId))) {
      console.log(`REFUSED ${q.id}: a Question Family member or an explanation with step images; change it in the CMS`);
      skipped++;
      continue;
    }
    if (commit) {
      if (rewriting || split || fixingKey) {
        // The editor's own write path, as an edit in the CMS: the split
        // passage, a corrected key, the explanation (rewritten, or with
        // "Step 3:" prefixes dropped) and the walkthrough, in one save.
        await updateDraftContent(question.id, {
          ...(split ? { passageText: q.passageText, questionText: q.questionText } : {}),
          ...(fixingKey && question.questionType === "MULTIPLE_CHOICE"
            ? {
                answerChoices: choices.map((c, i) => ({
                  text: c.text,
                  imageId: c.imageId,
                  isCorrect: c.isCorrect,
                  distractorExplanation: key.distractorExplanations[i] ?? c.distractorExplanation,
                })),
              }
            : {}),
          ...(fixingKey && question.questionType === "OPEN_ENDED_NUMERIC" ? { acceptedAnswers: key.acceptedAnswers } : {}),
          ...(rewriting ? { explanationSteps: steps.map((text) => ({ text, imageId: null })) } : {}),
          walkthrough: entry.walkthrough,
        });
      } else {
        await prisma.questionRevision.update({ where: { id: revision.id }, data: { walkthrough: entry.walkthrough as Prisma.InputJsonValue } });
      }
    }
    written++;
    const what = [
      fixingKey && "ANSWER KEY FIXED",
      split && "passage split out",
      rewriting && `explanation ${stored.length} → ${steps.length} steps`,
      "walkthrough",
    ]
      .filter(Boolean)
      .join(" + ");
    console.log(`${commit ? "wrote" : "would write"} ${q.id}${toMirror ? ` (local ${targetId})` : ""}: ${what}`);
  }
  console.log(`\n${commit ? "Wrote" : "Would write"} ${written}, skipped ${skipped}.${commit ? "" : " Nothing was written; add --commit."}`);
}

const commands: Record<string, () => Promise<void>> = { export: exportBatch, check, mirror, apply };
if (!command || !folder || !commands[command]) fail('Usage: npx tsx scripts/question-import/bank.ts <export|check|mirror|apply> "<batch folder>" [flags]');
commands[command]()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
