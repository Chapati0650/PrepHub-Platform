"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { searchOrganizationsAction } from "./actions";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { DirectoryResult } from "@/lib/organizations";

const DEBOUNCE_MS = 200;

export function DirectorySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Load the initial browse list (no query) once on mount.
    startTransition(async () => {
      const initial = await searchOrganizationsAction("");
      setResults(initial);
    });
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    setHasSearched(value.trim().length > 0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const found = await searchOrganizationsAction(value);
        setResults(found);
      });
    }, DEBOUNCE_MS);
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search schools and districts"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        aria-label="Search schools and districts"
      />

      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-border">
        {results.length === 0 && !isPending && hasSearched && (
          <p className="p-4 text-sm text-muted-foreground">
            We couldn&apos;t find that school or district. PrepHub may not be available there yet.
          </p>
        )}
        {results.length === 0 && !isPending && !hasSearched && (
          <p className="p-4 text-sm text-muted-foreground">No partner schools listed yet.</p>
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
    </div>
  );
}
