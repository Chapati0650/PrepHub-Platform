"use client";

import { Printer } from "lucide-react";

/** Prints the guide; the page's print styles leave just the steps and the help. */
export function PrintGuideButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-12 items-center gap-2 rounded-full border border-border px-5 text-base font-medium transition-colors hover:bg-muted print:hidden"
    >
      <Printer className="size-4" aria-hidden />
      Print this guide
    </button>
  );
}
