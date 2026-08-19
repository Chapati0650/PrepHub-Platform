"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Fallback used when NEXT_PUBLIC_DESMOS_API_KEY isn't configured (see
// calculator.tsx) — PRD-012 §21 / PRD-006: "If a native embedded Desmos
// experience is not technically available during initial development,
// PrepHub may use an equivalent approved calculator solution while
// preserving the intended workflow."
const BUTTONS = [
  "7", "8", "9", "/",
  "4", "5", "6", "*",
  "1", "2", "3", "-",
  "0", ".", "=", "+",
] as const;

function safeEvaluate(expression: string): string {
  if (!/^[0-9+\-*/.() ]*$/.test(expression)) return "Error";
  try {
    // Sandboxed to a digits/operators-only expression by the regex above.
    const result = Function(`"use strict"; return (${expression})`)();
    if (typeof result !== "number" || !Number.isFinite(result)) return "Error";
    return String(Math.round(result * 1e10) / 1e10);
  } catch {
    return "Error";
  }
}

export function FourFunctionCalculator() {
  const [open, setOpen] = useState(false);
  const [expression, setExpression] = useState("");

  const press = (key: string) => {
    if (key === "=") {
      setExpression(safeEvaluate(expression));
    } else {
      setExpression((prev) => (prev === "Error" ? key : prev + key));
    }
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Open calculator
      </Button>
    );
  }

  return (
    <div className="w-64 rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Calculator</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Close calculator">
          ×
        </Button>
      </div>
      <input
        type="text"
        readOnly
        value={expression}
        aria-label="Calculator display"
        className="mb-2 w-full rounded border border-border bg-muted px-2 py-1 text-right text-sm"
      />
      <div className="grid grid-cols-4 gap-1">
        {BUTTONS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            className="rounded border border-border py-1.5 text-sm hover:bg-muted"
          >
            {key}
          </button>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setExpression("")}>
        Clear
      </Button>
    </div>
  );
}
