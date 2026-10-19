/**
 * One-time backfill: recover the passage/question split for Reading & Writing
 * questions written before `passageText` existed.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-passages.mts          # dry run
 *   npx tsx --env-file=.env.local scripts/backfill-passages.mts --apply  # write
 *
 * Dry run by default, and prints every proposed split so they can be read
 * before anything is written.
 *
 * It writes `passageText` onto existing revisions, including published ones,
 * rather than creating draft revisions. That is a deliberate exception to
 * "revisions are immutable snapshots", justified by the operation being
 * content-preserving by construction: `passage` and `question` rejoined are
 * the original `questionText`, which `isLosslessSplit` asserts per row before
 * the write. A student mid-set sees the same words, laid out in two panes
 * instead of one. The alternative, a draft revision per question, would mean
 * republishing 150+ questions by hand for a change that alters no content.
 */
import { prisma } from "../src/lib/prisma";
import { isLosslessSplit, splitPassageAndQuestion } from "../src/lib/content/split-passage";

const READING_WRITING = ["READING_COMPREHENSION", "GRAMMAR", "VOCABULARY"] as const;
const apply = process.argv.includes("--apply");

async function main() {
  const revisions = await prisma.questionRevision.findMany({
    where: {
      passageText: null,
      question: { category: { in: [...READING_WRITING] } },
    },
    select: { id: true, questionText: true, question: { select: { category: true } } },
  });

  let split = 0;
  let skipped = 0;
  let unsafe = 0;

  for (const revision of revisions) {
    const result = splitPassageAndQuestion(revision.questionText);
    if (!result) {
      skipped++;
      continue;
    }
    if (!isLosslessSplit(revision.questionText, result)) {
      // Should be impossible given how the split is produced, so if it ever
      // fires it means the heuristic changed and this row needs a human.
      unsafe++;
      console.log(`UNSAFE  ${revision.id} (${revision.question.category})`);
      continue;
    }

    split++;
    console.log(`\n--- ${revision.id} (${revision.question.category})`);
    console.log(`PASSAGE  ${result.passage.slice(0, 110)}${result.passage.length > 110 ? "…" : ""}`);
    console.log(`QUESTION ${result.question}`);

    if (apply) {
      await prisma.questionRevision.update({
        where: { id: revision.id },
        data: { passageText: result.passage, questionText: result.question },
      });
    }
  }

  console.log(
    `\n${apply ? "APPLIED" : "DRY RUN"}: ${split} split, ${skipped} left alone, ${unsafe} unsafe, ${revisions.length} examined.`,
  );
  if (!apply && split > 0) console.log("Re-run with --apply to write these.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
