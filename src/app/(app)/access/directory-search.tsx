"use client";

import { useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { searchOrganizationsAction } from "./actions";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { DirectoryResult } from "@/lib/organizations";

const DEBOUNCE_MS = 200;

// Deliberately does not fetch or show anything on mount — an earlier version
// eagerly loaded and displayed the entire school/district directory before
// the student typed anything, which read as a raw internal database dump on
// a page a brand-new student sees on day one. Results only appear once a
// query is entered.
export function DirectorySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryResult[]>([]);
  const [hasQuery, setHasQuery] = useState(false);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setHasQuery(false);
      setResults([]);
      return;
    }

    setHasQuery(true);
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const found = await searchOrganizationsAction(value);
        setResults(found);
      });
    }, DEBOUNCE_MS);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          placeholder="Search schools or districts"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          aria-label="Search schools and districts"
          className="pl-9"
        />
      </div>

      {hasQuery && (
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-border">
          {isPending && results.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Searching…</p>
          )}
          {!isPending && results.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              We couldn&apos;t find that school or district. PrepHub may not be available there yet.
            </p>
          )}
          {results.map((org) => (
            <div
              key={org.id}
              className="flex items-center justify-between gap-3 border-b border-border p-3 last:border-b-0"
            >
              <div>
                <p className="text-sm font-medium">{org.name}</p>
                <p className="text-xs text-muted-foreground">
                  {org.type === "DISTRICT" ? "School district" : "School"}
                </p>
              </div>
              {org.available ? (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                  PrepHub available
                </Badge>
              ) : (
                <Badge variant="secondary">Not currently available</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
