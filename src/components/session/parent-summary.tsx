"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

// Parents pay for SAT prep. A student who wants to make the case gets the
// facts in one paste: the score, what's weak, what it costs. Plain text,
// no link tracking, nothing that isn't already on the screen.
export function ParentSummary({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard can be denied; the text is still readable below.
    }
  }

  return (
    <div className="rounded-2xl border border-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Sharing this with a parent?</p>
          <p className="mt-0.5 text-sm text-muted-foreground">Copy a short summary of your result and what comes next.</p>
        </div>
        <Button type="button" variant="outline" className="rounded-full" onClick={() => void copy()}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Copied" : "Copy summary"}
        </Button>
      </div>
      <pre className="mt-4 whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-sm text-muted-foreground">{text}</pre>
    </div>
  );
}
