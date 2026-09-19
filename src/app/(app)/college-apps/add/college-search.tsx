"use client";

import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addCollegeAction, searchCollegesAction } from "../actions";

type Result = Awaited<ReturnType<typeof searchCollegesAction>>[number];

// Search runs on the server (the directory is 500 KB of JSON) through a
// debounced action; each result is a plain form that posts the Scorecard id.
export function CollegeSearch({ alreadyAdded }: { alreadyAdded: number[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [searching, startSearch] = useTransition();
  const added = new Set(alreadyAdded);

  // No synchronous setState in the effect body (the repo's
  // react-hooks/set-state-in-effect rule): the only write happens inside the
  // debounced timeout, and a too-short query is handled at render by not
  // showing whatever the last search returned.
  const active = query.trim().length >= 2;
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => {
      startSearch(async () => {
        setResults(await searchCollegesAction(q));
      });
    }, 200);
    return () => clearTimeout(t);
  }, [query]);
  const visible = active ? results : [];

  return (
    <div className="flex flex-col gap-5">
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name — e.g. Rice, UCLA, Michigan"
        aria-label="Search colleges"
        className="h-12 rounded-full px-5 text-base"
      />
      {active && (
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border" aria-busy={searching}>
          {visible.length === 0 && !searching && <li className="px-4 py-6 text-sm text-muted-foreground">No colleges match &ldquo;{query.trim()}&rdquo;.</li>}
          {visible.map((c) => (
            <li key={c.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-muted-foreground">
                  {c.city}, {c.state}
                  {c.sat25 !== null && c.sat75 !== null && (
                    <span className="tabular-nums">
                      {" "}
                      · SAT {c.sat25}–{c.sat75}
                    </span>
                  )}
                  {c.admissionRate !== null && ` · ${Math.round(c.admissionRate * 100)}% admitted`}
                </p>
              </div>
              {added.has(c.id) ? (
                <span className="shrink-0 text-sm text-muted-foreground">On your list</span>
              ) : (
                <form action={addCollegeAction}>
                  <input type="hidden" name="collegeId" value={c.id} />
                  <Button type="submit" size="sm" className="rounded-full">
                    Add
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
