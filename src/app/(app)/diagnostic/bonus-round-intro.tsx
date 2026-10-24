import type { QuestionCategory } from "@/generated/prisma/client";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";
import { CATEGORY_LABELS } from "@/lib/content/labels";

/**
 * Between the core and the bonus round.
 *
 * The Hard questions used to arrive unannounced — the first one third in line,
 * on a Reading passage — and they read as a wall. Here they arrive as
 * something the student earned, named by the categories that earned them,
 * which is both true and the reason the round exists.
 *
 * "They can only raise your score" is a precise claim, checked against both
 * scoring tables: a Hard question the student didn't earn is scored as a wrong
 * answer, and with the Medium right, a right Hard raises the category in both
 * the ability table and the score table. So a miss here costs exactly what
 * never seeing the question would have.
 *
 * A student who earned nothing never reaches this screen: they finish at the
 * core and go straight to their results, and are never told they "unlocked
 * zero". Left-aligned on the tint like the other status screens; one marker,
 * one pill.
 */
export function BonusRoundIntro({
  count,
  categories,
  coreCount,
}: {
  count: number;
  categories: QuestionCategory[];
  coreCount: number;
}) {
  const names = categories.map((c) => CATEGORY_LABELS[c]);

  return (
    // flex-1 rather than a calc against the focus bar's height: the shell's
    // main is a flex column, so this fills exactly what's left beneath the bar
    // (a 4rem calc left a visible untinted strip along the bottom).
    <div className="flex flex-1 items-center bg-surface-tint">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6 sm:p-10">
        <div>
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            The Diagnostic · {coreCount} of {coreCount} done
          </p>
          <h1 className="mt-3 text-display-sm text-balance sm:text-display">
            You unlocked <Marker>{count === 1 ? "a bonus question" : `${count} bonus questions`}</Marker>.
          </h1>
          <p className="mt-4 max-w-prose text-lg text-muted-foreground">
            You got the harder question right in {count === 1 ? "this category" : `these ${count} categories`}, so
            each one gets a final, harder question to pin down your top score.
          </p>
        </div>

        <ul className="flex flex-wrap gap-2" aria-label="Categories with a bonus question">
          {names.map((name) => (
            <li key={name} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium">
              {name}
            </li>
          ))}
        </ul>

        <div>
          <LinkButton size="cta" href="/diagnostic?round=bonus">
            Start the bonus round
          </LinkButton>
          <p className="mt-4 max-w-prose text-sm text-muted-foreground">
            These can only raise your predicted score. A miss counts the same as never seeing the question.
          </p>
        </div>
      </div>
    </div>
  );
}
