"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { updateStudentInfoAction, type ActionState } from "./actions";
import type { StudentDirectoryEntry, StudentDirectoryFilters } from "@/lib/admin/student-directory";
import { useCloseDialogOnSuccess } from "@/hooks/use-close-dialog-on-success";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StaffField, StatusChip } from "@/components/staff/staff-ui";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
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

/**
 * When a student last practiced, the way a person says it: "Today",
 * "3 days ago", or a date once it's more than a month back.
 */
function lastActiveLabel(date: Date, now: number): string {
  const days = Math.floor((now - new Date(date).getTime()) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 31) return `${days} days ago`;
  return formatDate(date);
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

function statusChip(status: string) {
  return <StatusChip tone={status === "ACTIVE" ? "good" : "muted"}>{STATUS_LABELS[status] ?? status}</StatusChip>;
}

export function StudentDirectoryTable({
  students,
  total,
  page,
  pageCount,
  filters,
  currentYear,
  classYears,
}: {
  students: StudentDirectoryEntry[];
  total: number;
  page: number;
  pageCount: number;
  filters: StudentDirectoryFilters;
  currentYear: number;
  /** The class years an edit may set (graduationYearWindow); the server enforces the same. */
  classYears: ClassYears;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  // Read once for the "3 days ago" labels; a page load is a recent enough
  // "now" for a label measured in days.
  const [now] = useState(() => Date.now());

  function updateParams(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (!("page" in patch)) params.delete("page");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
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

  return (
    <section aria-labelledby="student-list-heading" className="flex flex-col gap-4">
      <h2 id="student-list-heading" className="text-xl">
        All students
      </h2>

      <div className="grid gap-4 rounded-2xl border border-border p-5 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1.3fr]">
        <StaffField label="Find a student" htmlFor="s-search">
          <Input
            id="s-search"
            placeholder="First name or school email"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-11 text-base md:text-base"
          />
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

        <StaffField label="Status" htmlFor="s-status">
          <Select value={filters.status ?? "ANY"} onValueChange={(v) => updateParams({ status: v === "ANY" || v === null ? undefined : v })}>
            <SelectTrigger id="s-status" className="h-11 w-full text-base md:text-base">
              <SelectValue>{(v: string) => (v === "ANY" ? "Any status" : (STATUS_LABELS[v] ?? v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any status</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-muted-foreground tabular-nums" role="status">
          {total === 0
            ? "No students to show."
            : `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} student${total === 1 ? "" : "s"}`}
        </p>
        {hasActiveFilters && (
          <Button
            variant="outline"
            size="xl"
            onClick={() => {
              setSearchInput("");
              router.push(pathname);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {students.length === 0 ? (
        <p className="rounded-2xl bg-surface-tint p-6 text-base text-muted-foreground">
          {hasActiveFilters
            ? "No students match these filters. Try clearing them."
            : "No students have signed up through your school yet. Once students create their accounts with their school email, they appear here automatically."}
        </p>
      ) : (
        <>
          {/* On a phone the table's columns put everything past the email
              off to the right, which hid the practice figures the page
              exists for. Below md, one stacked entry per student instead. */}
          <ul className="divide-y divide-border border-y border-border md:hidden">
            {students.map((s) => (
              <StudentListItem key={s.membershipId} student={s} now={now} classYears={classYears} />
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border border-border md:block">
            <table className="w-full text-base">
              <thead className="bg-muted/50 text-left text-sm">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Student
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Class of
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Questions
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Sessions
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Study time
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Last practiced
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {students.map((s) => (
                  <StudentRow key={s.membershipId} student={s} now={now} classYears={classYears} />
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
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
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
      <input type="hidden" name="membershipId" value={student.membershipId} />
      <p className="text-base">
        Correct <span className="font-medium">{student.firstName}</span>&apos;s first name or class year. Nothing else
        about a student can be changed here.
      </p>
      <p className="text-sm text-muted-foreground">
        A student&apos;s school access ends on July 1 of their class year, so only {classYears.min} to {classYears.max}{" "}
        can be chosen here: an earlier year would end their access right away.
      </p>
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
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

function StudentRow({ student, now, classYears }: { student: StudentDirectoryEntry; now: number; classYears: ClassYears }) {
  const { editing, setEditing, state, formAction } = useStudentEditing();

  if (editing) {
    return (
      <tr>
        <td colSpan={8} className="bg-surface-tint px-4 py-4">
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
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-3">
        <span className="block font-medium">{student.firstName}</span>
        <span className="block text-sm text-muted-foreground">{student.schoolEmail}</span>
      </td>
      <td className="px-4 py-3 tabular-nums">{student.graduationYear}</td>
      <td className="px-4 py-3 text-right tabular-nums">{student.activity.questionsAnswered.toLocaleString()}</td>
      <td className="px-4 py-3 text-right tabular-nums">{student.activity.sessionsCompleted}</td>
      <td className="px-4 py-3 text-right tabular-nums">{formatStudyTime(student.activity.studyHours)}</td>
      <td className="px-4 py-3">
        {student.lastActiveAt ? (
          <span title={formatDate(student.lastActiveAt)}>{lastActiveLabel(student.lastActiveAt, now)}</span>
        ) : (
          <StatusChip tone="warn">Not started</StatusChip>
        )}
      </td>
      <td className="px-4 py-3">{statusChip(student.status)}</td>
      <td className="px-4 py-3 text-right">
        {/* A removed or graduated student's record is history; the server refuses edits to it too. */}
        {student.status === "ACTIVE" && (
          <Button variant="outline" onClick={() => setEditing(true)} aria-label={`Edit ${student.firstName}`}>
            Edit
          </Button>
        )}
      </td>
    </tr>
  );
}

/** The same student, as one stacked entry for a phone. */
function StudentListItem({ student, now, classYears }: { student: StudentDirectoryEntry; now: number; classYears: ClassYears }) {
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
    <li className="flex flex-col gap-3 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-medium">{student.firstName}</p>
          <p className="truncate text-sm text-muted-foreground">{student.schoolEmail}</p>
        </div>
        {statusChip(student.status)}
      </div>
      <dl className="grid grid-cols-3 divide-x divide-border text-base">
        <div className="pr-3">
          <dt className="text-sm text-muted-foreground">Questions</dt>
          <dd className="tabular-nums">{student.activity.questionsAnswered.toLocaleString()}</dd>
        </div>
        <div className="px-3">
          <dt className="text-sm text-muted-foreground">Sessions</dt>
          <dd className="tabular-nums">{student.activity.sessionsCompleted}</dd>
        </div>
        <div className="pl-3">
          <dt className="text-sm text-muted-foreground">Study time</dt>
          <dd className="tabular-nums">{formatStudyTime(student.activity.studyHours)}</dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Class of {student.graduationYear} ·{" "}
          {student.lastActiveAt
            ? `Last practiced ${lastActiveLabel(student.lastActiveAt, now).toLowerCase()}`
            : "Hasn't started yet"}
        </p>
        {student.status === "ACTIVE" && (
          <Button variant="outline" size="xl" onClick={() => setEditing(true)} aria-label={`Edit ${student.firstName}`}>
            Edit
          </Button>
        )}
      </div>
    </li>
  );
}
