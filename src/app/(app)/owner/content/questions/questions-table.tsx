"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { QuestionListFilters, QuestionListRow } from "@/lib/content/list-questions";
import {
  CATEGORY_LABELS,
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
  STATUS_LABELS,
} from "@/lib/content/labels";
import { CATEGORY_ORDER, DIFFICULTY_ORDER } from "@/lib/content/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateQuestionDialog } from "./create-question-dialog";
import { StudentPreviewSheet } from "./student-preview-sheet";
import {
  archiveQuestionAction,
  bulkArchiveAction,
  bulkDeleteAction,
  bulkPublishAction,
  bulkUnpublishAction,
  deleteQuestionAction,
  duplicateQuestionAction,
  publishQuestionAction,
  restoreQuestionAction,
  unpublishQuestionAction,
} from "../actions";

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "PUBLISHED") return "default";
  if (status === "ARCHIVED") return "destructive";
  return "secondary";
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function plainTextPreview(text: string): string {
  const stripped = text.replace(/\$\$?[^$]*\$\$?/g, "[math]").trim();
  return stripped.length > 80 ? `${stripped.slice(0, 80)}…` : stripped || "(no question text yet)";
}

export function QuestionsTable({
  rows,
  totalCount,
  filters,
}: {
  rows: QuestionListRow[];
  totalCount: number;
  filters: QuestionListFilters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  // Clear selection whenever the visible row set changes (new page/filter/sort)
  // — adjusted during render per React's guidance, rather than in an effect.
  const [selectionResetKey, setSelectionResetKey] = useState(rows);
  if (selectionResetKey !== rows) {
    setSelectionResetKey(rows);
    setSelected(new Set());
  }

  function updateParams(patch: Record<string, string | undefined>, resetPage = true) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (resetPage) params.delete("page");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchInput !== (filters.search ?? "")) updateParams({ search: searchInput || undefined });
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const pageSize = filters.pageSize ?? 50;
  const page = filters.page ?? 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const hasActiveFilters = Boolean(
    filters.category ||
      filters.difficulty ||
      filters.questionType ||
      filters.status ||
      filters.familyMembership ||
      filters.videoStatus ||
      filters.writtenExplanationStatus ||
      filters.search,
  );

  function clearAllFilters() {
    setSearchInput("");
    router.push(pathname);
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  async function runBulk(action: (ids: string[]) => Promise<{ succeeded: string[]; failed: { questionId: string; reason?: string }[] }>) {
    const result = await action(selectedIds);
    if (result.failed.length === 0) {
      setBulkMessage(`Updated ${result.succeeded.length} question(s).`);
    } else {
      setBulkMessage(
        `Updated ${result.succeeded.length} question(s). ${result.failed.length} skipped: ${result.failed
          .map((f) => f.reason)
          .filter(Boolean)
          .slice(0, 2)
          .join(" ")}`,
      );
    }
    setSelected(new Set());
    router.refresh();
  }

  const previewRow = rows.find((r) => r.id === previewId) ?? null;
  const previewIndex = previewRow ? rows.indexOf(previewRow) : -1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Questions</h1>
        <CreateQuestionDialog />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="q-search">
            Search
          </label>
          <Input
            id="q-search"
            placeholder="Search question text…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-56"
          />
        </div>

        <FilterSelect
          label="Category"
          value={filters.category}
          onChange={(v) => updateParams({ category: v })}
          options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
        />
        <FilterSelect
          label="Difficulty"
          value={filters.difficulty}
          onChange={(v) => updateParams({ difficulty: v })}
          options={DIFFICULTY_ORDER.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))}
        />
        <FilterSelect
          label="Type"
          value={filters.questionType}
          onChange={(v) => updateParams({ questionType: v })}
          options={[
            { value: "MULTIPLE_CHOICE", label: "Multiple Choice" },
            { value: "OPEN_ENDED_NUMERIC", label: "Open-Ended Numeric" },
          ]}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => updateParams({ status: v })}
          options={[
            { value: "DRAFT", label: "Draft" },
            { value: "PUBLISHED", label: "Published" },
            { value: "DRAFT_REVISION", label: "Draft Revision" },
            { value: "ARCHIVED", label: "Archived" },
          ]}
        />
        <FilterSelect
          label="Family"
          value={filters.familyMembership}
          onChange={(v) => updateParams({ familyMembership: v })}
          options={[
            { value: "IN_FAMILY", label: "In a Question Family" },
            { value: "NOT_IN_FAMILY", label: "Not in a Question Family" },
          ]}
        />
        <FilterSelect
          label="Video"
          value={filters.videoStatus}
          onChange={(v) => updateParams({ videoStatus: v })}
          options={[
            { value: "PRESENT", label: "Required video present" },
            { value: "MISSING", label: "Missing required video" },
          ]}
        />
        <FilterSelect
          label="Written explanation"
          value={filters.writtenExplanationStatus}
          onChange={(v) => updateParams({ writtenExplanationStatus: v })}
          options={[
            { value: "PRESENT", label: "Present" },
            { value: "MISSING", label: "Missing" },
          ]}
        />
        <FilterSelect
          label="Sort"
          value={filters.sort}
          onChange={(v) => updateParams({ sort: v }, false)}
          options={[
            { value: "UPDATED_DESC", label: "Most recently updated" },
            { value: "UPDATED_ASC", label: "Least recently updated" },
            { value: "CREATED_DESC", label: "Newest created" },
            { value: "CREATED_ASC", label: "Oldest created" },
            { value: "CATEGORY", label: "Category" },
            { value: "DIFFICULTY", label: "Difficulty" },
          ]}
          allowClear={false}
        />

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            Clear All Filters
          </Button>
        )}

        <span className="ml-auto text-sm text-muted-foreground">{totalCount} result(s)</span>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
          <span className="text-sm">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => runBulk(bulkPublishAction)}>
            Publish
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk(bulkUnpublishAction)}>
            Unpublish
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk(bulkArchiveAction)}>
            Archive
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (confirm(`Permanently delete ${selected.size} question(s)? This cannot be undone.`)) {
                runBulk(bulkDeleteAction);
              }
            }}
          >
            Delete Permanently
          </Button>
        </div>
      )}
      {bulkMessage && <p className="text-sm text-muted-foreground">{bulkMessage}</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No questions match the current filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Question</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Difficulty</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Family</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const revision = row.currentDraftRevision ?? row.currentPublishedRevision;
                return (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => setPreviewId(row.id)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
                        aria-label={`Select question ${row.id}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-xs">{plainTextPreview(revision?.questionText ?? "")}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{CATEGORY_LABELS[row.category]}</TableCell>
                    <TableCell className="text-sm">{DIFFICULTY_LABELS[row.difficulty]}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{QUESTION_TYPE_LABELS[row.questionType]}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>{STATUS_LABELS[row.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.familyId ? "Yes" : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(row.updatedAt)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <RowActions row={row} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Page {page} of {totalPages}
          <Button
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => updateParams({ page: String(page - 1) }, false)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= totalPages}
            onClick={() => updateParams({ page: String(page + 1) }, false)}
          >
            Next
          </Button>
        </div>
        <FilterSelect
          label="Page size"
          value={String(pageSize)}
          onChange={(v) => updateParams({ pageSize: v }, false)}
          options={[
            { value: "25", label: "25" },
            { value: "50", label: "50" },
            { value: "100", label: "100" },
          ]}
          allowClear={false}
        />
      </div>

      <StudentPreviewSheet
        row={previewRow}
        open={previewRow !== null}
        onOpenChange={(open) => !open && setPreviewId(null)}
        onPrevious={previewIndex > 0 ? () => setPreviewId(rows[previewIndex - 1].id) : undefined}
        onNext={previewIndex >= 0 && previewIndex < rows.length - 1 ? () => setPreviewId(rows[previewIndex + 1].id) : undefined}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allowClear = true,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: { value: string; label: string }[];
  allowClear?: boolean;
}) {
  const id = `filter-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value ?? "ANY"} onValueChange={(v) => onChange(v === "ANY" || v === null ? undefined : v)}>
        <SelectTrigger id={id} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowClear && <SelectItem value="ANY">Any</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function RowActions({ row }: { row: QuestionListRow }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ error?: string }>) {
    const result = await action();
    if (result.error) setError(result.error);
    else router.refresh();
  }

  const isFamilyMember = row.familyId !== null;
  const canPublish = !isFamilyMember && (row.status === "DRAFT" || row.status === "DRAFT_REVISION");
  const canUnpublish = !isFamilyMember && (row.status === "PUBLISHED" || row.status === "DRAFT_REVISION");
  const canArchive = !isFamilyMember && row.status === "DRAFT";
  const canRestore = row.status === "ARCHIVED";
  const canDeletePermanently = !isFamilyMember && row.status !== "ARCHIVED" ? false : row.publishedAt === null && !isFamilyMember;

  return (
    <div className="flex items-center gap-2">
      <Link href={`/owner/content/questions/${row.id}`} className="text-sm underline">
        Edit
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="sm" variant="ghost">
              More
            </Button>
          }
        />
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => run(() => duplicateQuestionAction(row.id, false))}>
            Duplicate
          </DropdownMenuItem>
          {isFamilyMember && (
            <DropdownMenuItem onClick={() => run(() => duplicateQuestionAction(row.id, true))}>
              Duplicate into family
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {canPublish && (
            <DropdownMenuItem onClick={() => run(() => publishQuestionAction(row.id))}>
              {row.status === "DRAFT_REVISION" ? "Republish" : "Publish"}
            </DropdownMenuItem>
          )}
          {canUnpublish && (
            <DropdownMenuItem onClick={() => run(() => unpublishQuestionAction(row.id))}>Unpublish</DropdownMenuItem>
          )}
          {canArchive && (
            <DropdownMenuItem onClick={() => run(() => archiveQuestionAction(row.id))}>Archive</DropdownMenuItem>
          )}
          {canRestore && (
            <DropdownMenuItem onClick={() => run(() => restoreQuestionAction(row.id))}>Restore</DropdownMenuItem>
          )}
          {canDeletePermanently && (
            <DropdownMenuItem
              onClick={() => {
                if (confirm("Permanently delete this question? This cannot be undone.")) {
                  run(() => deleteQuestionAction(row.id));
                }
              }}
            >
              Delete permanently
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
