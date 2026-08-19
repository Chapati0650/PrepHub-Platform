"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// The digital SAT (via Bluebook) provides the full Desmos graphing
// calculator throughout the entire Math section — not a restricted
// four-function mode — so that's what's embedded here via Desmos's
// client-side API (desmos.com/api). The API key is meant to be public
// (loaded in the browser, restricted by domain in the Desmos dashboard),
// which is why it's a NEXT_PUBLIC_ env var rather than a server secret.
type DesmosCalculatorInstance = { destroy: () => void };
type DesmosGlobal = {
  GraphingCalculator: (el: HTMLElement, options?: Record<string, unknown>) => DesmosCalculatorInstance;
};

declare global {
  interface Window {
    Desmos?: DesmosGlobal;
  }
}

const DESMOS_API_KEY = process.env.NEXT_PUBLIC_DESMOS_API_KEY;
const SCRIPT_SRC = `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${DESMOS_API_KEY}`;

let scriptLoadPromise: Promise<void> | null = null;
function loadDesmosScript(): Promise<void> {
  if (window.Desmos) return Promise.resolve();
  if (!scriptLoadPromise) {
    scriptLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptLoadPromise = null;
        reject(new Error("Failed to load Desmos"));
      };
      document.head.appendChild(script);
    });
  }
  return scriptLoadPromise;
}

export function DesmosCalculator() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const calculatorRef = useRef<DesmosCalculatorInstance | null>(null);

  useEffect(() => {
    if (!open || !containerRef.current || calculatorRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    loadDesmosScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.Desmos) return;
        calculatorRef.current = window.Desmos.GraphingCalculator(containerRef.current, {
          settingsMenu: false,
          expressionsCollapsed: false,
        });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Destroy the instance on unmount only (not on close/open) — Desmos's
  // GraphingCalculator manages its own internal DOM and re-creating it on
  // every open would both be wasteful and drop the student's in-progress
  // graph/work while they're still on the same question.
  useEffect(() => {
    return () => {
      calculatorRef.current?.destroy();
      calculatorRef.current = null;
    };
  }, []);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Open calculator
      </Button>
    );
  }

  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Desmos Calculator</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Close calculator">
          ×
        </Button>
      </div>
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Couldn&apos;t load the calculator. Check your connection and try again.
        </p>
      ) : (
        <div className="relative h-96 w-full overflow-hidden rounded-lg border border-border">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-card text-sm text-muted-foreground">
              Loading calculator…
            </div>
          )}
          <div ref={containerRef} className="h-full w-full" />
        </div>
      )}
    </div>
  );
}
