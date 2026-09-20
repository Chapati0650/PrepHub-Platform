"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ParsedPrompt } from "@/lib/college-apps/parse-prompts";
import { parseSupplementsAction, saveParsedSupplementsAction } from "../actions";

// Paste → review → save. Each extracted prompt can be removed before anything
// is written; the model's output never lands in the curation unseen.
export function PasteSupplements({ collegeId, cycle, collegeName }: { collegeId: number; cycle: number; collegeName: string }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedPrompt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [busy, start] = useTransition();

  function parse() {
    setError(null);
    setSavedCount(null);
    start(async () => {
      const res = await parseSupplementsAction(text);
      if (res.error) setError(res.error);
      else setParsed(res.prompts ?? []);
    });
  }
  function save() {
    if (!parsed?.length) return;
    const n = parsed.length;
    start(async () => {
      const res = await saveParsedSupplementsAction(collegeId, cycle, parsed);
      if (res.error) setError(res.error);
      else {
        setSavedCount(n);
        setParsed(null);
        setText("");
      }
    });
  }

  return (
    <section className="rounded-2xl bg-surface-tint p-5">
      <h2 className="font-medium">Paste {collegeName}&apos;s prompts</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Copy the Writing section for this college from Common App and paste it here. The prompts and word limits
        come back for you to check, then save as this cycle&apos;s supplements in one click.
      </p>
      {parsed === null ? (
        <div className="mt-4 flex flex-col gap-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Paste the prompts here…"
            aria-label="Pasted prompts"
            className="bg-background"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {savedCount !== null && (
            <p className="text-sm text-muted-foreground">
              Added {savedCount} prompt{savedCount === 1 ? "" : "s"} above.
            </p>
          )}
          <Button type="button" onClick={parse} disabled={busy || text.trim().length < 20} className="w-fit rounded-full px-5">
            {busy ? "Reading…" : "Find the prompts"}
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm font-medium">
            Found {parsed.length} prompt{parsed.length === 1 ? "" : "s"}. Remove any that aren&apos;t right, then save.
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background">
            {parsed.map((p, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p.title}
                    {p.wordLimit && <span className="ml-2 text-xs font-normal text-muted-foreground">{p.wordLimit} words</span>}
                  </p>
                  <p className="mt-0.5 text-sm whitespace-pre-line text-muted-foreground">{p.text}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${p.title}`}
                  onClick={() => setParsed(parsed.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" onClick={save} disabled={busy || parsed.length === 0} className="rounded-full px-5">
              {busy ? "Saving…" : `Save ${parsed.length} as supplements`}
            </Button>
            <Button type="button" variant="ghost" className="rounded-full" onClick={() => setParsed(null)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
