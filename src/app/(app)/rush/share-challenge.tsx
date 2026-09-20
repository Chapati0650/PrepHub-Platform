"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

// The friend-challenge handoff: a link for a text message and a code for
// reading aloud. Both open the same challenge; the code is the link's last
// segment, so there is one thing to keep, not two.
export function ShareChallenge({ code, joinUrl, compact = false }: { code: string; joinUrl: string; compact?: boolean }) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy(kind: "link" | "code") {
    try {
      await navigator.clipboard.writeText(kind === "link" ? joinUrl : code);
      setCopied(kind);
    } catch {
      // Clipboard access can be denied (insecure context, permissions). The
      // text is on screen and selectable either way.
    }
  }

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "flex flex-col gap-4"}>
      <div className="flex items-center gap-2">
        <span className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Code</span>
        <span className="font-heading text-2xl font-semibold tracking-[0.2em] tabular-nums">{code}</span>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => void copy("code")} aria-label="Copy code">
          {copied === "code" ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <input
          readOnly
          value={joinUrl}
          aria-label="Challenge link"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
        />
        <Button type="button" variant="outline" className="rounded-full" onClick={() => void copy("link")}>
          {copied === "link" ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}
