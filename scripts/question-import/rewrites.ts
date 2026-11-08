/**
 * PrepHub rewrites of imported questions, into the bank (2026-11-07).
 *
 * Rewrites are written outside this repo, in Downloads\PrepHub\Question
 * rewrites\<batch>\ (new-questions.json, figures/, walkthroughs.json keyed by
 * ref). This turns a batch into an import folder for import.ts, then retires
 * the originals the rewrites replace.
 *
 *   npx tsx scripts/question-import/rewrites.ts build "<rewrite batch>" "<import folder>"
 *       Offline. Writes <import folder>/questions.json in import.ts's shape and
 *       pages/: a question's figure PNG is its page, boxed whole; a question
 *       without one gets a small labelled placeholder page (import.ts hashes a
 *       question's first page as its source image). Checks every question's
 *       text the way import.ts does and validates every walkthrough with the
 *       site's own validator. Exits 1 on any problem.
 *
 *   npx tsx scripts/question-import/rewrites.ts retire "<test folder>" "<import folder>" [--production] [--commit]
 *       For each rewrite that the import folder's import-log.json records as
 *       created, and that is live, finds its original (the test's
 *       questions.json, matched in the bank by content exactly as import.ts
 *       matches duplicates) and unpublishes it through unpublishQuestion: back
 *       to Draft with its content kept, so it can be republished. Writes
 *       retire-log.json. Without --commit it only reports.
 *
 *   npx tsx scripts/question-import/rewrites.ts update "<import folder>" [--refs=RW1-04,RW1-12] [--production] [--commit]
 *       Fixes rewrites that are already live. Run build first. For each
 *       question in the import folder's questions.json (or only --refs), it
 *       compares the rebuilt content with the live revision of the question
 *       import-log.json created, and lists the fields that differ. With
 *       --commit it writes only those fields through updateDraftContent, the
 *       CMS editor's own save, which applies an edit to a Published standalone
 *       question to its live revision and keeps every choice's id. It saves the
 *       old values in update-log-<time>.json. It refuses to move the correct
 *       answer (answers are graded by choice id) and skips anything that isn't
 *       a live standalone question. Figures aren't compared or changed.
 *
 *   npx tsx --env-file=.env.r2 scripts/question-import/rewrites.ts export-bank "<out folder>" [--production]
 *       Read-only. Exports every live standalone question that no import
 *       created (no production import-log.json lists it) and that came from a
 *       test (a bulk upload, or AI-generated content from before uploads were
 *       hashed), as a test folder the rewrite tools can read: questions.json
 *       (refs BR-001… for Reading and Writing, BM-001… for Math, each with the
 *       bankIds it stands for) and figures/<ref>.png from storage. A live
 *       question that is a test folder's question in other words (text and
 *       choices nearly identical) isn't exported; it is written to that test
 *       folder's bank-duplicates.json, which retire also unpublishes.
 */
import "dotenv/config";
import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/prisma";
import { getQuestionOrThrow, unpublishQuestion, updateDraftContent, type QuestionContentPatch } from "../../src/lib/content/questions";
import { readFromStorage } from "../../src/lib/content/storage";
import { lintWalkthrough, validateWalkthrough } from "../../src/lib/content/walkthrough-validate";

const LETTERS = ["A", "B", "C", "D"];
const args = process.argv.slice(2);
const [command, first, second] = args.filter((a) => !a.startsWith("--"));
const commit = args.includes("--commit");
const production = args.includes("--production");

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

type Rewrite = {
  source: { test: string; ref: string };
  category: string;
  difficulty: string;
  spec?: { reasoning?: string; wrongAnswerDesign?: string };
  questionType: "MULTIPLE_CHOICE" | "OPEN_ENDED_NUMERIC";
  passageText?: string | null;
  questionText: string;
  choices?: string[];
  correctChoiceIndex?: number;
  acceptedAnswers?: string[];
  explanationSteps: string[];
  distractorExplanations?: (string | null)[];
  figure?: { file?: string; svg?: string; note?: string };
  walkthrough?: unknown;
};

/** The text checks import.ts makes before it will write a question. */
function textProblems(texts: string[]): string[] {
  const problems: string[] = [];
  for (const text of texts) {
    const delimiters = (text.replace(/\\\$/g, "").match(/\$/g) ?? []).length;
    if (delimiters % 2 !== 0) problems.push(`unbalanced $ in: ${text.slice(0, 60)}…`);
    if ((text.match(/\[\[/g) ?? []).length !== (text.match(/\]\]/g) ?? []).length) problems.push(`unbalanced [[ ]] in: ${text.slice(0, 60)}…`);
    if (/[\u0000-\u0009\u000B-\u001F]/.test(text)) problems.push(`a control character (one backslash in the JSON?) in: ${JSON.stringify(text.slice(0, 60))}…`);
    const math = text.replace(/\\\$/g, "").match(/\$\$[^$]+\$\$|\$[^$]+\$/g) ?? [];
    if (math.some((segment) => segment.includes("\n"))) problems.push(`a line break inside math in: ${JSON.stringify(text.slice(0, 60))}…`);
  }
  return problems;
}

async function build(batchDir: string, outDir: string) {
  const rewrites: Rewrite[] = JSON.parse(await readFile(path.join(batchDir, "new-questions.json"), "utf-8"));
  const walkthroughFile = path.join(batchDir, "walkthroughs.json");
  const walkthroughs: Record<string, unknown> = existsSync(walkthroughFile) ? JSON.parse(await readFile(walkthroughFile, "utf-8")) : {};
  await mkdir(path.join(outDir, "pages"), { recursive: true });

  const problems: string[] = [];
  const advice: string[] = [];
  const questions = [];
  for (const [i, r] of rewrites.entries()) {
    const ref = r.source.ref;
    const page = i + 1;
    const pageFile = path.join(outDir, "pages", `page-${String(page).padStart(3, "0")}.png`);
    let figure: { page: number; box: [number, number, number, number] } | null = null;
    if (r.figure?.file) {
      const source = path.join(batchDir, r.figure.file);
      if (!existsSync(source)) problems.push(`${ref}: ${r.figure.file} not found (the rewrite check renders it from the SVG)`);
      else {
        await copyFile(source, pageFile);
        figure = { page, box: [0, 0, 1000, 1000] };
      }
    } else {
      const label = `PrepHub rewrite: ${r.source.test} ${ref}`.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="60"><rect width="640" height="60" fill="#fff"/><text x="12" y="38" font-family="Arial" font-size="22">${label}</text></svg>`;
      await sharp(Buffer.from(svg)).png().toFile(pageFile);
    }

    const mc = r.questionType === "MULTIPLE_CHOICE";
    const walkthrough = r.walkthrough ?? walkthroughs[ref];
    const q = {
      ref,
      pages: [page],
      questionType: r.questionType,
      category: r.category,
      difficulty: r.difficulty,
      difficultyReasoning: `PrepHub rewrite of ${r.source.test} ${ref}, written at the original's difficulty.${r.spec?.reasoning ? ` ${r.spec.reasoning}` : ""}`,
      passageText: r.passageText ?? null,
      questionText: r.questionText,
      choices: mc ? (r.choices ?? null) : null,
      correctChoiceIndex: mc ? (r.correctChoiceIndex ?? null) : null,
      acceptedAnswers: mc ? [] : (r.acceptedAnswers ?? []),
      answerConfidence: "high",
      answerReasoning: `Written for PrepHub with the key set by construction${r.spec?.wrongAnswerDesign ? `: ${r.spec.wrongAnswerDesign}` : "."}`,
      answerKey: mc ? (r.correctChoiceIndex !== undefined ? LETTERS[r.correctChoiceIndex] : null) : (r.acceptedAnswers?.[0] ?? null),
      explanationSteps: r.explanationSteps,
      distractorExplanations: mc ? (r.distractorExplanations ?? null) : null,
      figure,
      ...(walkthrough !== undefined ? { walkthrough } : {}),
    };

    if (mc) {
      if (q.choices?.length !== 4) problems.push(`${ref}: multiple choice needs four choices`);
      if (q.correctChoiceIndex === null) problems.push(`${ref}: no correctChoiceIndex`);
      const notes = q.distractorExplanations ?? [];
      if (notes.length !== 4 || notes.some((n, j) => (j === q.correctChoiceIndex) !== (n === null))) {
        problems.push(`${ref}: distractorExplanations needs a note per wrong choice and null at the key`);
      }
    } else if (q.acceptedAnswers.length === 0) problems.push(`${ref}: a grid-in needs acceptedAnswers`);
    problems.push(
      ...textProblems([
        q.passageText ?? "",
        q.questionText,
        ...(q.choices ?? []),
        ...q.explanationSteps,
        ...(q.distractorExplanations ?? []).filter((n): n is string => n !== null),
      ]).map((p) => `${ref}: ${p}`),
    );

    if (walkthrough === undefined) problems.push(`${ref}: no walkthrough`);
    else {
      const check = validateWalkthrough(walkthrough, {
        passageText: q.passageText,
        choiceCount: q.choices?.length ?? 0,
        correctIndex: q.correctChoiceIndex,
        stepCount: q.explanationSteps.length,
      });
      if (!check.ok) problems.push(...check.problems.map((p) => `${ref}: walkthrough: ${p}`));
      else for (const a of lintWalkthrough(check.spec)) advice.push(`${ref}: ${a}`);
    }
    questions.push(q);
  }

  const test = rewrites[0]?.source.test ?? "unknown test";
  await writeFile(
    path.join(outDir, "questions.json"),
    JSON.stringify({ source: `PrepHub rewrites of ${test} (${path.basename(path.resolve(batchDir))})`, questions }, null, 2),
  );
  for (const a of advice) console.log(`~ ${a}`);
  if (problems.length) fail(`PROBLEMS:\n  ${problems.join("\n  ")}`);
  console.log(`${questions.length} questions built into ${outDir}: all valid${advice.length ? ` (${advice.length} advice lines above)` : ""}`);
}

// --- Matching originals in the bank: the same key import.ts uses for duplicates.

function contentKey(passage: string | null, stem: string, choices: string[] = []): string {
  const text = `${passage ?? ""} ${stem}`.toLowerCase().replace(/\$/g, "").replace(/\s+/g, " ").trim();
  const options = choices.map((c) => c.toLowerCase().replace(/\\[a-z]+/g, "").replace(/[^a-z0-9.-]/g, ""));
  return options.length ? `${text} | ${options.join(" | ")}` : text;
}

function gridInValues(answers: string[]): string[] {
  const values = answers.map((answer) => {
    const a = answer.trim();
    const fraction = /^(-?\d*\.?\d+)\/(\d*\.?\d+)$/.exec(a);
    const n = fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(a);
    return Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : a.toLowerCase();
  });
  return [...new Set(values)].sort();
}

function optionsOf(choices: string[] | null | undefined, acceptedAnswers: string[] | null | undefined): string[] {
  return choices?.length ? choices : gridInValues(acceptedAnswers ?? []);
}

/** The same local/production guard as import.ts. */
function guardDatabase() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
  if (!local && !production) fail("DATABASE_URL isn't the local database. Add --production if that is intended.");
  if (local && production) fail("--production was given, but DATABASE_URL is the local database.");
}

/** The guard, then the ref → question id pairs the import created. */
async function createdQuestions(importDir: string): Promise<Map<string, string>> {
  guardDatabase();
  const importLog = JSON.parse(await readFile(path.join(importDir, "import-log.json"), "utf-8"));
  if (!!importLog.production !== production) fail("import-log.json records an import into the other database.");
  return new Map<string, string>(
    (importLog.results as { ref: string; questionId?: string }[]).filter((r) => r.questionId).map((r) => [r.ref, r.questionId!]),
  );
}

/** JSON with object keys sorted, so a walkthrough read back from Postgres jsonb compares equal to the file's. */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(sort(value ?? null));
}

async function update(importDir: string) {
  const created = await createdQuestions(importDir);
  const refsArg = args.find((a) => a.startsWith("--refs="));
  const only = refsArg ? new Set(refsArg.slice("--refs=".length).split(",").filter(Boolean)) : null;
  const built = JSON.parse(await readFile(path.join(importDir, "questions.json"), "utf-8")).questions as {
    ref: string;
    passageText: string | null;
    questionText: string;
    choices: string[] | null;
    correctChoiceIndex: number | null;
    acceptedAnswers: string[];
    explanationSteps: string[];
    distractorExplanations: (string | null)[] | null;
    walkthrough?: unknown;
  }[];
  if (only) for (const ref of only) if (!built.some((q) => q.ref === ref)) fail(`${ref} isn't in ${importDir}/questions.json.`);

  const results: { ref: string; questionId?: string; action: string; fields?: string[]; before?: Record<string, unknown> }[] = [];
  for (const q of built) {
    if (only && !only.has(q.ref)) continue;
    const questionId = created.get(q.ref);
    if (!questionId) {
      results.push({ ref: q.ref, action: "skipped: import-log.json has no question for it" });
      continue;
    }
    const question = await getQuestionOrThrow(questionId);
    const live = question.currentPublishedRevision;
    if (question.status !== "PUBLISHED" || question.familyId || !live) {
      results.push({ ref: q.ref, questionId, action: `skipped: ${question.familyId ? "in a Question Family" : question.status}, not a live standalone` });
      continue;
    }

    const patch: QuestionContentPatch = {};
    const before: Record<string, unknown> = {};
    if ((live.passageText ?? null) !== (q.passageText ?? null)) {
      patch.passageText = q.passageText;
      before.passageText = live.passageText;
    }
    if (live.questionText !== q.questionText) {
      patch.questionText = q.questionText;
      before.questionText = live.questionText;
    }
    if (q.choices) {
      const liveChoices = [...live.answerChoices].sort((a, b) => a.order - b.order);
      const was = liveChoices.map((c) => ({ text: c.text, isCorrect: c.isCorrect, distractorExplanation: c.distractorExplanation ?? null }));
      const now = q.choices.map((text, i) => ({
        text,
        isCorrect: i === q.correctChoiceIndex,
        distractorExplanation: i === q.correctChoiceIndex ? null : (q.distractorExplanations?.[i] ?? null),
      }));
      if (canonical(was.map((c) => c.isCorrect)) !== canonical(now.map((c) => c.isCorrect))) {
        results.push({ ref: q.ref, questionId, action: "REFUSED: the correct choice would move (answers are graded by choice id)" });
        continue;
      }
      if (canonical(was) !== canonical(now)) {
        patch.answerChoices = now.map((c, i) => ({ ...c, imageId: liveChoices[i]?.imageId ?? null }));
        before.answerChoices = was;
      }
    } else if (canonical(live.acceptedAnswers) !== canonical(q.acceptedAnswers)) {
      patch.acceptedAnswers = q.acceptedAnswers;
      before.acceptedAnswers = live.acceptedAnswers;
    }
    const liveSteps = [...live.explanationSteps].sort((a, b) => a.order - b.order);
    if (canonical(liveSteps.map((s) => s.text)) !== canonical(q.explanationSteps)) {
      patch.explanationSteps = q.explanationSteps.map((text, i) => ({ text, imageId: liveSteps[i]?.imageId ?? null }));
      before.explanationSteps = liveSteps.map((s) => s.text);
    }
    if (canonical(live.walkthrough) !== canonical(q.walkthrough)) {
      patch.walkthrough = q.walkthrough ?? null;
      before.walkthrough = live.walkthrough;
    }

    const fields = Object.keys(before);
    if (fields.length === 0) results.push({ ref: q.ref, questionId, action: "unchanged" });
    else if (!commit) results.push({ ref: q.ref, questionId, action: "would update", fields });
    else {
      try {
        await updateDraftContent(questionId, patch);
        results.push({ ref: q.ref, questionId, action: "updated", fields, before });
      } catch (err) {
        results.push({ ref: q.ref, questionId, action: `FAILED: ${err instanceof Error ? err.message : String(err)}`, fields });
      }
    }
  }

  for (const r of results) console.log(`${r.ref.padEnd(9)}${r.action}${r.fields ? `: ${r.fields.join(", ")}` : ""}`);
  const tally = results.reduce<Record<string, number>>((t, r) => ({ ...t, [r.action.split(":")[0]]: (t[r.action.split(":")[0]] ?? 0) + 1 }), {});
  console.log(`\n${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  if (commit && results.some((r) => r.before)) {
    const file = `update-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(path.join(importDir, file), JSON.stringify({ at: new Date().toISOString(), production, results }, null, 2));
    console.log(`Wrote ${file} (old values of every changed field).`);
  } else if (!commit) console.log("Report only: re-run with --commit to write the changes.");
}

// --- Exporting live questions that came from no test folder.

const MATH_CATEGORIES = new Set(["ALGEBRA", "ADVANCED_MATH", "PROBLEM_SOLVING_DATA_ANALYSIS", "GEOMETRY_TRIGONOMETRY"]);
// The test folders live outside the repo (they are never committed); QUESTION_IMPORTS_DIR overrides the default.
const IMPORTS_ROOT = process.env.QUESTION_IMPORTS_DIR ?? path.join(homedir(), "Downloads", "PrepHub", "Question imports");

/** Word trigrams of a question's text, numbers included, so variants with new numbers stay apart. */
function trigrams(text: string): Set<string> {
  const words = text.toLowerCase().replace(/\\[a-z]+/g, " ").replace(/[^a-z0-9.]+/g, " ").trim().split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 3 <= words.length; i++) out.add(words.slice(i, i + 3).join(" "));
  if (words.length < 3) out.add(words.join(" "));
  return out;
}
function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  return shared / Math.max(1, Math.min(a.size, b.size));
}
type Fingerprint = { grams: Set<string>; numbers: string; options: string[] };
const fingerprint = (passage: string | null, stem: string, options: string[]): Fingerprint => ({
  grams: trigrams(`${passage ?? ""} ${stem}`),
  // A test's variants are the same words with new numbers, so the numbers must match too.
  numbers: (`${passage ?? ""} ${stem}`.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(\.\d+)?/g) ?? []).sort().join(" "),
  options: options.map((o) => o.toLowerCase().replace(/\\[a-z]+/g, "").replace(/[^a-z0-9.-]/g, "")),
});
/** The same question in other words: text nearly identical, the same numbers, and at least three options (or a grid-in value) shared. */
function sameQuestion(a: Fingerprint, b: Fingerprint): boolean {
  if (a.numbers !== b.numbers || overlap(a.grams, b.grams) < 0.85) return false;
  const shared = a.options.filter((o) => o && b.options.includes(o)).length;
  return a.options.length <= 1 || b.options.length <= 1 ? shared >= 1 : shared >= 3;
}

async function exportBank(outDir: string) {
  guardDatabase();
  const outName = path.basename(path.resolve(outDir));

  // Every question an import created (tests and rewrites) is accounted for already.
  const imported = new Set<string>();
  for (const root of [IMPORTS_ROOT, path.join(IMPORTS_ROOT, "Rewrites")])
    for (const dir of readdirSync(root)) {
      const file = path.join(root, dir, "import-log.json");
      if (!existsSync(file)) continue;
      const log = JSON.parse(await readFile(file, "utf-8"));
      if (!!log.production !== production) continue;
      for (const r of log.results as { questionId?: string }[]) if (r.questionId) imported.add(r.questionId);
    }

  // Every test's originals, to recognise a live question that is one of them in other words.
  const testQuestions: { folder: string; ref: string; print: Fingerprint }[] = [];
  for (const dir of readdirSync(IMPORTS_ROOT)) {
    const file = path.join(IMPORTS_ROOT, dir, "questions.json");
    if (dir === outName || dir === "Rewrites" || !existsSync(file)) continue;
    const test = JSON.parse(await readFile(file, "utf-8"));
    for (const q of (Array.isArray(test) ? test : test.questions) as { ref: string; passageText: string | null; questionText: string; choices: string[] | null; acceptedAnswers: string[] | null }[])
      testQuestions.push({ folder: dir, ref: q.ref, print: fingerprint(q.passageText, q.questionText, optionsOf(q.choices, q.acceptedAnswers)) });
  }

  const live = await prisma.question.findMany({
    where: { status: "PUBLISHED", familyId: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      category: true,
      difficulty: true,
      questionType: true,
      sourceImageHash: true,
      currentPublishedRevision: {
        select: {
          passageText: true,
          questionText: true,
          acceptedAnswers: true,
          aiGenerated: true,
          questionImage: { select: { storageKey: true } },
          answerChoices: { orderBy: { order: "asc" }, select: { text: true, isCorrect: true, distractorExplanation: true } },
          explanationSteps: { orderBy: { order: "asc" }, select: { text: true } },
        },
      },
    },
  });

  const skipped = { imported: 0, handMade: 0 };
  const duplicates: Record<string, Record<string, string[]>> = {};
  const exported: { q: Record<string, unknown>; print: Fingerprint; bankIds: string[]; imageKey?: string; math: boolean }[] = [];
  for (const q of live) {
    const r = q.currentPublishedRevision;
    if (!r || imported.has(q.id)) {
      skipped.imported++;
      continue;
    }
    // Neither uploaded from a page nor AI-generated: written in the CMS by hand.
    if (!q.sourceImageHash && !r.aiGenerated) {
      skipped.handMade++;
      continue;
    }
    const choices = r.answerChoices.map((c) => c.text);
    const print = fingerprint(r.passageText, r.questionText, optionsOf(choices, r.acceptedAnswers));
    const inTest = testQuestions.find((t) => sameQuestion(t.print, print));
    if (inTest) {
      ((duplicates[inTest.folder] ??= {})[inTest.ref] ??= []).push(q.id);
      continue;
    }
    const twin = exported.find((e) => sameQuestion(e.print, print));
    if (twin) {
      twin.bankIds.push(q.id);
      continue;
    }
    const correct = r.answerChoices.findIndex((c) => c.isCorrect);
    const multipleChoice = q.questionType === "MULTIPLE_CHOICE";
    exported.push({
      print,
      bankIds: [q.id],
      imageKey: r.questionImage?.storageKey,
      math: MATH_CATEGORIES.has(q.category),
      q: {
        questionType: q.questionType,
        category: q.category,
        difficulty: q.difficulty,
        difficultyReasoning: "Difficulty as stored in the bank.",
        passageText: r.passageText,
        questionText: r.questionText,
        choices: multipleChoice ? choices : null,
        correctChoiceIndex: multipleChoice ? correct : null,
        acceptedAnswers: multipleChoice ? [] : r.acceptedAnswers,
        answerConfidence: "high",
        answerReasoning: "The bank's key.",
        answerKey: multipleChoice ? LETTERS[correct] : (r.acceptedAnswers[0] ?? null),
        explanationSteps: r.explanationSteps.map((s) => s.text),
        distractorExplanations: multipleChoice ? r.answerChoices.map((c) => (c.isCorrect ? null : c.distractorExplanation)) : null,
      },
    });
  }

  // Reading and Writing first, then Math, each grouped by category, numbered within its prefix.
  exported.sort((a, b) => Number(a.math) - Number(b.math) || String(a.q.category).localeCompare(String(b.q.category)));
  await mkdir(path.join(outDir, "figures"), { recursive: true });
  const counters = { BR: 0, BM: 0 };
  const questions = [];
  for (const e of exported) {
    const prefix = e.math ? "BM" : "BR";
    const ref = `${prefix}-${String(++counters[prefix]).padStart(3, "0")}`;
    let figure = null;
    if (e.imageKey) {
      await sharp(await readFromStorage(e.imageKey)).png().toFile(path.join(outDir, "figures", `${ref}.png`));
      figure = { file: `figures/${ref}.png` };
    }
    questions.push({ ref, pages: [], ...e.q, figure, bankIds: e.bankIds });
  }
  await writeFile(
    path.join(outDir, "questions.json"),
    JSON.stringify({ source: `PrepHub bank: live questions from no test folder (exported ${new Date().toISOString().slice(0, 10)})`, questions }, null, 2),
  );
  for (const [folder, refs] of Object.entries(duplicates)) {
    const file = path.join(IMPORTS_ROOT, folder, "bank-duplicates.json");
    const before: Record<string, string[]> = existsSync(file) ? JSON.parse(await readFile(file, "utf-8")) : {};
    for (const [ref, ids] of Object.entries(refs)) before[ref] = [...new Set([...(before[ref] ?? []), ...ids])];
    await writeFile(file, JSON.stringify(before, null, 2));
  }

  console.log(`${live.length} live standalone questions: ${skipped.imported} from imports, ${skipped.handMade} written by hand.`);
  for (const [folder, refs] of Object.entries(duplicates))
    console.log(`  ${Object.values(refs).flat().length} are questions of "${folder}" in other words → its bank-duplicates.json`);
  console.log(
    `Exported ${questions.length} (${counters.BR} BR, ${counters.BM} BM; ${exported.reduce((n, e) => n + e.bankIds.length - 1, 0)} more live copies folded in) to ${outDir}`,
  );
}

async function retire(testDir: string, importDir: string) {
  const created = await createdQuestions(importDir);
  const test = JSON.parse(await readFile(path.join(testDir, "questions.json"), "utf-8"));
  const originals = ((Array.isArray(test) ? test : test.questions) as {
    ref: string;
    passageText: string | null;
    questionText: string;
    choices: string[] | null;
    acceptedAnswers: string[] | null;
    bankIds?: string[]; // an export-bank folder names the live questions each ref stands for
  }[]).filter((q) => created.has(q.ref));
  // Live questions export-bank found to be one of this test's questions in other words.
  const duplicatesFile = path.join(testDir, "bank-duplicates.json");
  const bankDuplicates: Record<string, string[]> = existsSync(duplicatesFile) ? JSON.parse(await readFile(duplicatesFile, "utf-8")) : {};

  const content = { select: { questionText: true, passageText: true, acceptedAnswers: true, answerChoices: { orderBy: { order: "asc" as const }, select: { text: true } } } };
  const bank = await prisma.question.findMany({
    select: { id: true, status: true, familyId: true, currentPublishedRevision: content, currentDraftRevision: content },
  });
  const byKey = new Map<string, { id: string; status: string; familyId: string | null }[]>();
  const statusOf = new Map<string, string>();
  const familyOf = new Map<string, string | null>();
  for (const q of bank) {
    statusOf.set(q.id, q.status);
    familyOf.set(q.id, q.familyId);
    for (const revision of [q.currentPublishedRevision, q.currentDraftRevision]) {
      if (!revision) continue;
      const key = contentKey(revision.passageText, revision.questionText, optionsOf(revision.answerChoices.map((c) => c.text), revision.acceptedAnswers));
      const list = byKey.get(key) ?? [];
      if (!list.some((x) => x.id === q.id)) list.push({ id: q.id, status: q.status, familyId: q.familyId });
      byKey.set(key, list);
    }
  }

  const rewriteIds = new Set(created.values());
  const results: { ref: string; rewriteId: string; originalId?: string; statusBefore?: string; action: string }[] = [];
  for (const original of originals) {
    const rewriteId = created.get(original.ref)!;
    if (statusOf.get(rewriteId) !== "PUBLISHED") {
      results.push({ ref: original.ref, rewriteId, action: `kept: the rewrite is ${statusOf.get(rewriteId) ?? "missing"}, not live` });
      continue;
    }
    const byId = (id: string) => ({ id, status: statusOf.get(id) ?? "missing", familyId: familyOf.get(id) ?? null });
    const matches = (
      original.bankIds?.length
        ? original.bankIds.map(byId)
        : (byKey.get(contentKey(original.passageText, original.questionText, optionsOf(original.choices, original.acceptedAnswers))) ?? [])
    ).filter((m) => !rewriteIds.has(m.id));
    for (const id of bankDuplicates[original.ref] ?? []) if (!matches.some((m) => m.id === id) && !rewriteIds.has(id)) matches.push(byId(id));
    if (matches.length === 0) {
      results.push({ ref: original.ref, rewriteId, action: "original not found in the bank (edited since import?)" });
      continue;
    }
    for (const m of matches) {
      const entry = { ref: original.ref, rewriteId, originalId: m.id, statusBefore: m.status };
      if (m.status !== "PUBLISHED" && m.status !== "DRAFT_REVISION") results.push({ ...entry, action: "already not live" });
      else if (m.familyId) results.push({ ...entry, action: "kept: in a Question Family (unpublish it from the Families page)" });
      else if (!commit) results.push({ ...entry, action: "would unpublish" });
      else {
        try {
          await unpublishQuestion(m.id);
          results.push({ ...entry, action: "unpublished" });
        } catch (err) {
          results.push({ ...entry, action: `FAILED: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }
  }

  for (const r of results) console.log(`${r.ref.padEnd(9)}${(r.originalId ?? "-").padEnd(28)}${r.action}`);
  const tally = results.reduce<Record<string, number>>((t, r) => ({ ...t, [r.action.split(":")[0]]: (t[r.action.split(":")[0]] ?? 0) + 1 }), {});
  console.log(`\n${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  if (commit) {
    // A second run (say, after export-bank found more duplicates) keeps the first run's log.
    const file = existsSync(path.join(importDir, "retire-log.json"))
      ? `retire-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
      : "retire-log.json";
    await writeFile(path.join(importDir, file), JSON.stringify({ at: new Date().toISOString(), production, testFolder: testDir, results }, null, 2));
    console.log(`Wrote ${file}. To undo one, publish its originalId again from the CMS (it is a Draft with its content kept).`);
  } else console.log("Report only: re-run with --commit to unpublish.");
}

async function main() {
  if (command === "build" && first && second) await build(first, second);
  else if (command === "retire" && first && second) await retire(first, second);
  else if (command === "update" && first) await update(first);
  else if (command === "export-bank" && first) await exportBank(first);
  else
    fail(
      'Usage: rewrites.ts build "<rewrite batch>" "<import folder>" | retire "<test folder>" "<import folder>" | update "<import folder>" [--refs=…] — retire and update take [--production] [--commit]',
    );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
