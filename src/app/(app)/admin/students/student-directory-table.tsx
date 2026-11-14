"use client";

import { CampusField } from "../campus-field";
import { useActionState, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Search, X } from "lucide-react";
import { updateStudentInfoAction, type ActionState, type ReminderPreviewResult } from "./actions";
import type { StudentDirectoryEntry, StudentDirectoryFilters } from "@/lib/admin/student-directory";
import { reminderTemplateFor } from "@/lib/admin/reminder-message";
import { useCloseDialogOnSuccess } from "@/hooks/use-close-dialog-on-success";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StaffField, StatusChip } from "@/components/staff/staff-ui";
import { cn } from "@/lib/utils";
import { ReminderComposer } from "./reminder-composer";

const STATUS_LABELS: Record<string, string> = {
  // "Has access", not "Active": beside "Not started" it read as a contradiction, and "Active this
  // week" on the same page means practiced (review, 2026-11-09).
  ACTIVE: "Has access",
  REMOVED: "Removed",
  GRADUATED: "Graduated",
};

const ACTIVITY_LABELS: Record<string, string> = {
  ANY: "Anyone",
  ACTIVE_THIS_WEEK: "Active this week",
  NOT_STARTED: "Haven't started yet",
  GONE_QUIET: "Gone quiet (2 weeks)",
};

const initialState: ActionState = {};

type ClassYears = { min: number; max: number };

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(date: Date, now: number): number {
  return Math.floor((now - new Date(date).getTime()) / DAY_MS);
}

/**
 * When a student last practiced, the way a person says it: "Today",
 * "3 days ago", or a date once it's more than a month back.
 */
function lastActiveLabel(date: Date, now: number): string {
  const days = daysAgo(date, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 31) return `${days} days ago`;
  return formatDate(date);
}

function remindedLabel(date: Date, now: number): string {
  const days = daysAgo(date, now);
  if (days <= 0) return "Reminded today";
  if (days === 1) return "Reminded yesterday";
  return `Reminded ${days} days ago`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Study time derived from session start/finish, so it is approximate by
 * construction (PrepHub deliberately never times individual questions — see
 * CLAUDE.md). Shown in minutes below an hour so a student who has done one
 * session doesn't read as a flat "0 hr".
 */
function formatStudyTime(hours: number): string {
  if (hours <= 0) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} hr`;
}

function students(n: number): string {
  return `${n.toLocaleString()} student${n === 1 ? "" : "s"}`;
}

/** Who a reminder to the whole filtered list is for, in the composer's words. */
function audienceFor(filters: StudentDirectoryFilters, total: number): string {
  const n = students(total);
  switch (filters.activity) {
    case "NOT_STARTED":
      return `the ${n} who haven't started yet`;
    case "GONE_QUIET":
      return `the ${n} who have gone quiet`;
    case "ACTIVE_THIS_WEEK":
      return `the ${n} who practiced this week`;
    default:
      return filters.search || filters.graduationYear || filters.status ? `the ${n} in this list` : `every student in this list (${total.toLocaleString()})`;
  }
}

/**
 * The student list (2026-11-14): filters, then one bar that says what's
 * showing and offers what to do with it — email exactly these students,
 * or download them — then the table. Tick students to act on just those.
 */
export function StudentDirectoryTable({
  students: rows,
  total,
  page,
  pageCount,
  filters,
  filtersQuery,
  currentYear,
  classYears,
  schoolName,
  senderName,
  composeOnLoad,
  composePreview,
}: {
  students: StudentDirectoryEntry[];
  total: number;
  page: number;
  pageCount: number;
  filters: StudentDirectoryFilters;
  /** The list's filters as a query string (no page), which the email and download actions re-read on the server. */
  filtersQuery: string;
  currentYear: number;
  /** The class years an edit may set (graduationYearWindow); the server enforces the same. */
  classYears: ClassYears;
  schoolName: string;
  senderName: string;
  /** Arrived from the Overview's "Remind them": open the composer for this list straight away. */
  composeOnLoad: boolean;
  composePreview: ReminderPreviewResult | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  // Read once for the "3 days ago" labels; a page load is a recent enough
  // "now" for a label measured in days.
  const [now] = useState(() => Date.now());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // A different list (new filters or page) starts with nothing ticked:
  // adjusted during render, not in an effect (CLAUDE.md's lint rule).
  const listKey = `${filtersQuery}|${page}`;
  const [selectionFor, setSelectionFor] = useState(listKey);
  if (selectionFor !== listKey) {
    setSelectionFor(listKey);
    setSelected(new Set());
  }

  function updateParams(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (!("page" in patch)) params.delete("page");
    params.delete("compose");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function dropComposeParam() {
    if (!searchParams.has("compose")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("compose");
    router.replace(`${pathname}${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchInput !== (filters.search ?? "")) updateParams({ search: searchInput || undefined });
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const graduationYears = Array.from({ length: 7 }, (_, i) => currentYear + i);
  const hasActiveFilters = Boolean(filters.search || filters.graduationYear || filters.status || filters.activity);
  const pageSize = 50;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const school = searchParams.get("school");
  const template = reminderTemplateFor(filters.activity);
  const nudgeList = filters.activity === "NOT_STARTED" || filters.activity === "GONE_QUIET";
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.membershipId));
  const someOnPage = rows.some((r) => selected.has(r.membershipId));
  const firstSelected = rows.find((r) => selected.has(r.membershipId));
  const firstCurrent = rows.find((r) => r.status === "ACTIVE") ?? rows[0];

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePage(on: boolean) {
    setSelected(on ? new Set(rows.map((r) => r.membershipId)) : new Set());
  }

  return (
    <section aria-labelledby="student-list-heading" className="flex flex-col gap-5">
      <h2 id="student-list-heading" className="text-2xl">
        Student list
      </h2>

      <div className="grid gap-4 rounded-2xl border border-border p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-[2fr_1fr_1fr_1.3fr]">
        <StaffField label="Find a student" htmlFor="s-search">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="s-search"
              placeholder="First name or school email"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-11 pl-10 text-base md:text-base"
            />
          </div>
        </StaffField>

        <StaffField label="Class of" htmlFor="s-grad-year">
          <Select
            value={filters.graduationYear ? String(filters.graduationYear) : "ANY"}
            onValueChange={(v) => updateParams({ graduationYear: v === "ANY" || v === null ? undefined : v })}
          >
            <SelectTrigger id="s-grad-year" className="h-11 w-full text-base md:text-base">
              <SelectValue>{(v: string) => (v === "ANY" ? "Any year" : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any year</SelectItem>
              {graduationYears.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </StaffField>

        <StaffField label="Access" htmlFor="s-status">
          <Select value={filters.status ?? "ANY"} onValueChange={(v) => updateParams({ status: v === "ANY" || v === null ? undefined : v })}>
            <SelectTrigger id="s-status" className="h-11 w-full text-base md:text-base">
              <SelectValue>{(v: string) => (v === "ANY" ? "Anyone" : (STATUS_LABELS[v] ?? v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Anyone</SelectItem>
              <SelectItem value="ACTIVE">Has access</SelectItem>
              <SelectItem value="REMOVED">Removed</SelectItem>
              <SelectItem value="GRADUATED">Graduated</SelectItem>
            </SelectContent>
          </Select>
        </StaffField>

        <StaffField label="Practice" htmlFor="s-activity">
          <Select
            value={filters.activity ?? "ANY"}
            onValueChange={(v) => updateParams({ activity: v === "ANY" || v === null ? undefined : v })}
          >
            <SelectTrigger id="s-activity" className="h-11 w-full text-base md:text-base">
              <SelectValue>{(v: string) => ACTIVITY_LABELS[v] ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </StaffField>
      </div>

      {/* What's showing, and what to do with it. With students ticked, the
          actions are for those; otherwise for the whole list, every page of it. */}
      <div
        className={cn(
          "flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5",
          selected.size > 0 || nudgeList ? "bg-surface-tint" : "bg-muted/50",
        )}
      >
        {selected.size > 0 ? (
          <>
            <p className="text-lg font-medium" role="status">
              {students(selected.size)} selected
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" size="xl" onClick={() => setSelected(new Set())}>
                <X aria-hidden />
                Clear
              </Button>
              <ReminderComposer
                key={`selected-${[...selected].join(",")}`}
                request={{ school, filtersQuery, membershipIds: [...selected] }}
                count={selected.size}
                audience={selected.size === 1 ? `${firstSelected?.firstName ?? "the student"}, whom you selected` : `the ${students(selected.size)} you selected`}
                template={template}
                schoolName={schoolName}
                senderName={senderName}
                sampleFirstName={firstSelected?.firstName ?? "Maya"}
                label={`Email ${selected.size === 1 ? "this student" : `these ${selected.size}`}`}
                primary
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-lg tabular-nums" role="status">
              {total === 0 ? (
                "No students to show."
              ) : (
                <>
                  <span className="font-medium">{students(total)}</span>
                  {filters.activity ? ` · ${ACTIVITY_LABELS[filters.activity].toLowerCase()}` : ""}
                  {pageCount > 1 && (
                    <span className="text-muted-foreground">
                      {" "}
                      · showing {first.toLocaleString()}–{last.toLocaleString()}
                    </span>
                  )}
                </>
              )}
            </p>
            {total > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                {hasActiveFilters && (
                  // A plain link: the browser downloads the file.
                  <a href={`/admin/students/export?${filtersQuery}`} className={cn(buttonVariants({ variant: "outline", size: "xl" }), "bg-background")}>
                    <Download aria-hidden />
                    Download this list
                  </a>
                )}
                <ReminderComposer
                  key={`list-${filtersQuery}`}
                  request={{ school, filtersQuery, membershipIds: null }}
                  count={total}
                  audience={audienceFor(filters, total)}
                  template={template}
                  schoolName={schoolName}
                  senderName={senderName}
                  sampleFirstName={firstCurrent?.firstName ?? "Maya"}
                  label={hasActiveFilters ? `Email ${total === 1 ? "this student" : `these ${total.toLocaleString()}`}` : `Email all ${total.toLocaleString()}`}
                  primary={nudgeList}
                  initialOpen={composeOnLoad}
                  initialPreview={composePreview}
                  onClosed={dropComposeParam}
                />
              </div>
            )}
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-4 rounded-2xl bg-surface-tint p-6">
          <p className="text-lg">
            {hasActiveFilters
              ? "No students match these filters."
              : "No students have signed up through your school yet. Once students create their accounts with their school email, they appear here automatically."}
          </p>
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="xl"
              className="bg-background"
              onClick={() => {
                setSearchInput("");
                router.push(school ? `${pathname}?school=${encodeURIComponent(school)}` : pathname);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* On a phone the table's columns put everything past the email
              off to the right, which hid the practice figures the page
              exists for. Below md, one stacked entry per student instead. */}
          <ul className="divide-y divide-border border-y border-border md:hidden">
            {rows.map((s) => (
              <StudentListItem
                key={s.membershipId}
                student={s}
                now={now}
                classYears={classYears}
                checked={selected.has(s.membershipId)}
                onCheck={(on) => toggle(s.membershipId, on)}
              />
            ))}
          </ul>
          {/* `relative`: the sr-only labels in its cells are absolutely positioned,
              and without a positioned ancestor inside the scroller they escape it
              and widen the whole page on a phone. */}
          <div className="relative hidden overflow-x-auto rounded-2xl border border-border md:block">
            <table className="w-full text-base">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="w-12 py-3.5 pr-1 pl-5">
                    <Checkbox
                      checked={allOnPage}
                      indeterminate={someOnPage && !allOnPage}
                      onCheckedChange={(on) => togglePage(Boolean(on))}
                      aria-label={allOnPage ? "Untick every student on this page" : "Tick every student on this page"}
                      className="size-5"
                    />
                  </th>
                  <th scope="col" className="px-4 py-3.5 font-medium">
                    Student
                  </th>
                  <th scope="col" className="px-4 py-3.5 font-medium whitespace-nowrap">
                    Class of
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right font-medium">
                    Questions
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right font-medium">
                    Sessions
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right font-medium whitespace-nowrap">
                    Study time
                  </th>
                  <th scope="col" className="px-4 py-3.5 font-medium whitespace-nowrap">
                    Last practiced
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((s) => (
                  <StudentRow
                    key={s.membershipId}
                    student={s}
                    now={now}
                    classYears={classYears}
                    checked={selected.has(s.membershipId)}
                    onCheck={(on) => toggle(s.membershipId, on)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Paging lives in the URL, so a particular page of the directory is a
          real address an administrator can bookmark or share with a
          colleague, and the back button behaves. */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-4 border-t border-border pt-5">
          <p className="text-base text-muted-foreground tabular-nums">
            Page {page} of {pageCount}
          </p>
          <div className="flex gap-3">
            <Button variant="outline" size="xl" disabled={page <= 1} onClick={() => updateParams({ page: String(page - 1) })}>
              ← Previous
            </Button>
            <Button
              variant="outline"
              size="xl"
              disabled={page >= pageCount}
              onClick={() => updateParams({ page: String(page + 1) })}
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function useStudentEditing() {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(updateStudentInfoAction, initialState);

  // The form is a plain <form action>, so Next.js auto-refreshes this route's
  // server data after it resolves — only the still-open edit form needs closing.
  useCloseDialogOnSuccess(state.success, setEditing);
  return { editing, setEditing, state, formAction };
}

function StudentEditForm({
  student,
  state,
  formAction,
  onCancel,
  classYears,
}: {
  student: StudentDirectoryEntry;
  state: ActionState;
  formAction: (formData: FormData) => void;
  onCancel: () => void;
  classYears: ClassYears;
}) {
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <CampusField />
      <input type="hidden" name="membershipId" value={student.membershipId} />
      <p className="text-lg">
        Correct <span className="font-medium">{student.firstName}</span>&apos;s first name or class year. Nothing else
        about a student can be changed here.
      </p>
      <p className="text-base text-muted-foreground">
        A student&apos;s school access ends on July 1 of their class year, so only {classYears.min} to {classYears.max}{" "}
        can be chosen here: an earlier year would end their access right away.
      </p>
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription className="text-base">{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <StaffField label="First name" htmlFor={`fn-${student.membershipId}`}>
          <Input
            id={`fn-${student.membershipId}`}
            name="firstName"
            defaultValue={student.firstName}
            className="h-11 w-48 text-base md:text-base"
            required
          />
        </StaffField>
        <StaffField label="Class of" htmlFor={`gy-${student.membershipId}`}>
          <Input
            id={`gy-${student.membershipId}`}
            name="expectedGraduationYear"
            type="number"
            // An unchanged year is always accepted, so the bounds stretch to
            // include whatever is on file.
            min={Math.min(classYears.min, student.graduationYear)}
            max={Math.max(classYears.max, student.graduationYear)}
            defaultValue={student.graduationYear}
            className="h-11 w-32 text-base md:text-base"
            required
          />
        </StaffField>
        <Button type="submit" size="xl">
          Save
        </Button>
        <Button type="button" variant="ghost" size="xl" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Last practiced, with "Reminded …" under it when the school has emailed them lately. */
function ActivityCell({ student, now }: { student: StudentDirectoryEntry; now: number }) {
  return (
    <span className="flex flex-col items-start gap-1">
      {student.lastActiveAt ? (
        <span className="whitespace-nowrap" title={formatDate(student.lastActiveAt)}>
          {lastActiveLabel(student.lastActiveAt, now)}
        </span>
      ) : (
        <StatusChip tone="warn">Not started</StatusChip>
      )}
      {student.lastRemindedAt && (
        <span className="text-base whitespace-nowrap text-primary dark:text-marker" title={formatDate(student.lastRemindedAt)}>
          {remindedLabel(student.lastRemindedAt, now)}
        </span>
      )}
    </span>
  );
}

function StudentRow({
  student,
  now,
  classYears,
  checked,
  onCheck,
}: {
  student: StudentDirectoryEntry;
  now: number;
  classYears: ClassYears;
  checked: boolean;
  onCheck: (on: boolean) => void;
}) {
  const { editing, setEditing, state, formAction } = useStudentEditing();

  if (editing) {
    return (
      <tr>
        <td colSpan={8} className="bg-surface-tint px-5 py-5">
          <StudentEditForm
            student={student}
            state={state}
            formAction={formAction}
            onCancel={() => setEditing(false)}
            classYears={classYears}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr className={cn("transition-colors", checked ? "bg-surface-tint" : "hover:bg-muted/40")}>
      <td className="py-4 pr-1 pl-5 align-top">
        <Checkbox
          checked={checked}
          onCheckedChange={(on) => onCheck(Boolean(on))}
          aria-label={`Select ${student.firstName}`}
          className="mt-1 size-5"
        />
      </td>
      <td className="max-w-[22rem] px-4 py-4 align-top">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-medium">{student.firstName}</span>
          {/* Only the exceptions: "Has access" on all fifty rows was noise. */}
          {student.status !== "ACTIVE" && <StatusChip tone="muted">{STATUS_LABELS[student.status] ?? student.status}</StatusChip>}
        </span>
        <span className="block truncate text-base text-muted-foreground" title={student.schoolEmail}>
          {student.schoolEmail}
        </span>
      </td>
      <td className="px-4 py-4 align-top tabular-nums">{student.graduationYear}</td>
      <td className="px-4 py-4 text-right align-top tabular-nums">{student.activity.questionsAnswered.toLocaleString()}</td>
      <td className="px-4 py-4 text-right align-top tabular-nums">{student.activity.sessionsCompleted}</td>
      <td className="px-4 py-4 text-right align-top whitespace-nowrap tabular-nums">{formatStudyTime(student.activity.studyHours)}</td>
      <td className="px-4 py-4 align-top">
        <ActivityCell student={student} now={now} />
      </td>
      <td className="px-4 py-4 text-right align-top">
        {/* A removed or graduated student's record is history; the server refuses edits to it too. */}
        {student.status === "ACTIVE" && (
          <Button variant="ghost" size="xl" onClick={() => setEditing(true)} aria-label={`Edit ${student.firstName}`}>
            Edit
          </Button>
        )}
      </td>
    </tr>
  );
}

/** The same student, as one stacked entry for a phone. */
function StudentListItem({
  student,
  now,
  classYears,
  checked,
  onCheck,
}: {
  student: StudentDirectoryEntry;
  now: number;
  classYears: ClassYears;
  checked: boolean;
  onCheck: (on: boolean) => void;
}) {
  const { editing, setEditing, state, formAction } = useStudentEditing();

  if (editing) {
    return (
      <li className="py-4">
        <StudentEditForm
          student={student}
          state={state}
          formAction={formAction}
          onCancel={() => setEditing(false)}
          classYears={classYears}
        />
      </li>
    );
  }

  return (
    <li className={cn("flex gap-3 py-4", checked && "bg-surface-tint")}>
      <Checkbox
        checked={checked}
        onCheckedChange={(on) => onCheck(Boolean(on))}
        aria-label={`Select ${student.firstName}`}
        className="mt-1.5 size-5"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-medium">{student.firstName}</p>
            <p className="truncate text-base text-muted-foreground">{student.schoolEmail}</p>
          </div>
          {student.status !== "ACTIVE" && <StatusChip tone="muted">{STATUS_LABELS[student.status] ?? student.status}</StatusChip>}
        </div>
        <dl className="grid grid-cols-3 divide-x divide-border text-base">
          <div className="pr-3">
            <dt className="text-muted-foreground">Questions</dt>
            <dd className="tabular-nums">{student.activity.questionsAnswered.toLocaleString()}</dd>
          </div>
          <div className="px-3">
            <dt className="text-muted-foreground">Sessions</dt>
            <dd className="tabular-nums">{student.activity.sessionsCompleted}</dd>
          </div>
          <div className="pl-3">
            <dt className="text-muted-foreground">Study time</dt>
            <dd className="tabular-nums">{formatStudyTime(student.activity.studyHours)}</dd>
          </div>
        </dl>
        <div className="flex items-center justify-between gap-3">
          <div className="text-base text-muted-foreground">
            <p>
              Class of {student.graduationYear} ·{" "}
              {student.lastActiveAt ? `Last practiced ${lastActiveLabel(student.lastActiveAt, now).toLowerCase()}` : "Hasn't started yet"}
            </p>
            {student.lastRemindedAt && <p className="text-primary dark:text-marker">{remindedLabel(student.lastRemindedAt, now)}</p>}
          </div>
          {student.status === "ACTIVE" && (
            <Button variant="outline" size="xl" onClick={() => setEditing(true)} aria-label={`Edit ${student.firstName}`}>
              Edit
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
