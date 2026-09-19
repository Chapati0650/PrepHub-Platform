"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { searchCollegesForOwnerAction } from "./actions";

type Result = Awaited<ReturnType<typeof searchCollegesForOwnerAction>>[number];

export function OwnerCollegeSearch({ cycle }: { cycle: number }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [, start] = useTransition();

  // See college-search.tsx: no synchronous setState in the effect body.
  const active = query.trim().length >= 2;
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => start(async () => setResults(await searchCollegesForOwnerAction(q))), 200);
    return () => clearTimeout(t);
  }, [query]);
  const visible = active ? results : [];

  return (
    <div className="flex flex-col gap-3">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="College name" aria-label="Search colleges" className="max-w-md" />
      {visible.length > 0 && (
        <ul className="max-w-md divide-y divide-border rounded-xl border border-border">
          {visible.map((c) => (
            <li key={c.id}>
              <Link href={`/owner/content/supplements/${c.id}?cycle=${cycle}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-muted/40">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground">
                  {c.city}, {c.state}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
