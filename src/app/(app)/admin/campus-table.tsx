"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/** One campus row as the district table shows it, already protected (strings for withheld cells). */
export type CampusTableRow = {
  campusId: string;
  name: string;
  registered: number;
  started: number | null;
  activeThisWeek: number | null;
  questionsAnswered: number;
  averageGain: number | null;
  /** Share meeting TSI (for sorting) with its words, or a status. */
  tsi: { meet: number; measured: number } | "WITHHELD" | "NOT_ENOUGH" | "SMALL";
};

type Key =
  | "name"
  | "registered"
  | "started"
  | "activeThisWeek"
  | "questionsAnswered"
  | "averageGain"
  | "tsi";

const COLUMNS: { key: Key; label: string }[] = [
  { key: "name", label: "Campus" },
  { key: "registered", label: "Signed up" },
  { key: "started", label: "Started practicing" },
  { key: "activeThisWeek", label: "Active this week" },
  { key: "questionsAnswered", label: "Questions answered" },
  { key: "averageGain", label: "Average gain" },
  { key: "tsi", label: "Meet TSI now" },
];

function sortValue(r: CampusTableRow, key: Key): number | string | null {
  if (key === "name") return r.name.toLowerCase();
  if (key === "tsi")
    return typeof r.tsi === "object"
      ? r.tsi.meet / Math.max(1, r.tsi.measured)
      : null;
  return r[key];
}

/**
 * The district's campus table, sortable by any column (2026-11-09: Houston ISD has about 270 campuses,
 * and the point of the table is finding the ones behind). Withheld and not-yet cells sort last either
 * way. Every cell is computed and protected on the server; this only orders them.
 */
export function CampusTable({
  rows,
  smallGroup,
}: {
  rows: CampusTableRow[];
  smallGroup: number;
}) {
  const [key, setKey] = useState<Key>("name");
  const [asc, setAsc] = useState(true);
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp =
        typeof va === "string"
          ? va.localeCompare(String(vb))
          : (va as number) - (vb as number);
      return asc ? cmp : -cmp;
    });
  }, [rows, key, asc]);

  const count = (v: number | null) =>
    v === null ? `Fewer than ${smallGroup}` : v.toLocaleString();
  const gain = (v: number | null) =>
    v === null ? "Not enough yet" : v > 0 ? `+${v}` : String(v);
  const tsi = (t: CampusTableRow["tsi"]) =>
    t === "NOT_ENOUGH"
      ? "Not enough yet"
      : t === "WITHHELD"
        ? "Withheld"
        : t === "SMALL"
          ? `Fewer than ${smallGroup}`
          : `${t.meet.toLocaleString()} of ${t.measured.toLocaleString()} (${Math.round((100 * t.meet) / Math.max(1, t.measured))}%)`;

  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border border-border print:overflow-visible">
        <table className="w-full min-w-[56rem] text-left text-base print:min-w-0 print:text-sm">
          <caption className="sr-only">
            PrepHub activity by campus. Use the column buttons to sort.
          </caption>
          <thead className="bg-surface-tint text-sm">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-4 py-3 font-semibold ${c.key === "name" ? "" : "text-right"}`}
                  aria-sort={
                    key === c.key ? (asc ? "ascending" : "descending") : "none"
                  }
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-semibold hover:underline print:no-underline"
                    onClick={() => {
                      if (key === c.key) setAsc(!asc);
                      else {
                        setKey(c.key);
                        // Names A to Z; numbers biggest first, which is usually the question asked.
                        setAsc(c.key === "name");
                      }
                    }}
                  >
                    {c.label}
                    <span aria-hidden className="print:hidden">
                      {key === c.key ? (asc ? "↑" : "↓") : ""}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((r) => (
              <tr key={r.campusId}>
                <th scope="row" className="min-w-[13rem] px-4 py-3 font-medium">
                  <Link
                    href={`/admin?school=${r.campusId}`}
                    className="underline underline-offset-4"
                  >
                    {r.name}
                  </Link>
                </th>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.registered.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {count(r.started)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {count(r.activeThisWeek)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.questionsAnswered.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {gain(r.averageGain)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {tsi(r.tsi)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-muted-foreground md:hidden">
        Swipe the table sideways to see every column.
      </p>
    </div>
  );
}
