"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { updateStudentInfoAction, type ActionState } from "./actions";
import type { StudentDirectoryEntry, StudentDirectoryFilters } from "@/lib/admin/student-directory";
import { useCloseDialogOnSuccess } from "@/hooks/use-close-dialog-on-success";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  REMOVED: "Removed",
  GRADUATED: "Graduated",
};

const initialState: ActionState = {};

function formatDate(date: Date | null): string {
  if (!date) return "Never";
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Study time derived from session start/finish, so it is approximate by
 * construction (PrepHub deliberately never times individual questions — see
 * CLAUDE.md). Shown in minutes below an hour so a student who has done one
 * session doesn't read as a flat "0h".
 */
function formatStudyTime(hours: number): string {
  if (hours <= 0) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10}h`;
}

export function StudentDirectoryTable({
  students,
  total,
  page,
  pageCount,
  filters,
  currentYear,
}: {
  students: StudentDirectoryEntry[];
  total: number;
  page: number;
  pageCount: number;
  filters: StudentDirectoryFilters;
  currentYear: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(filters.search ?? "");

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
  const hasActiveFilters = Boolean(filters.search || filters.graduationYear || filters.status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="s-search" className="text-xs text-muted-foreground">
            Search
          </Label>
          <Input
            id="s-search"
            placeholder="First name or school email…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-64"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="s-grad-year" className="text-xs text-muted-foreground">
            Graduation Year
          </Label>
          <Select
            value={filters.graduationYear ? String(filters.graduationYear) : "ANY"}
            onValueChange={(v) => updateParams({ graduationYear: v === "ANY" || v === null ? undefined : v })}
          >
            <SelectTrigger id="s-grad-year" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any</SelectItem>
              {graduationYears.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="s-status" className="text-xs text-muted-foreground">
            Account Status
          </Label>
          <Select value={filters.status ?? "ANY"} onValueChange={(v) => updateParams({ status: v === "ANY" || v === null ? undefined : v })}>
            <SelectTrigger id="s-status" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="REMOVED">Removed</SelectItem>
              <SelectItem value="GRADUATED">Graduated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
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
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          {hasActiveFilters
            ? "No students match these filters."
            : "No students have registered through your school yet. Once students create their accounts using your school's access method, they will appear here automatically."}
        </p>
      ) : (
        <>
          {/* On a phone the table's ten columns put everything past the email
              off to the right, which hid the engagement figures the page
              exists for. Below sm, one stacked entry per student instead. */}
          <ul className="divide-y divide-border border-y border-border sm:hidden">
            {students.map((s) => (
              <StudentListItem key={s.membershipId} student={s} />
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>First Name</TableHead>
                  <TableHead>School Email</TableHead>
                  <TableHead>Grad. Year</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Questions</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Study Time</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Last Active</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <StudentRow key={s.membershipId} student={s} />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Paging lives in the URL, so a particular page of the directory is a
          real address an administrator can bookmark or share with a
          colleague, and the back button behaves. */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground tabular-nums">
            Page {page} of {pageCount} &middot; {total.toLocaleString()} students
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => updateParams({ page: String(page - 1) })}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => updateParams({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
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
}: {
  student: StudentDirectoryEntry;
  state: ActionState;
  formAction: (formData: FormData) => void;
  onCancel: () => void;
}) {
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="membershipId" value={student.membershipId} />
      {state.error && (
        <Alert variant="destructive" className="w-full">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor={`fn-${student.membershipId}`} className="text-xs text-muted-foreground">
          First Name
        </Label>
        <Input id={`fn-${student.membershipId}`} name="firstName" defaultValue={student.firstName} className="w-40" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`gy-${student.membershipId}`} className="text-xs text-muted-foreground">
          Graduation Year
        </Label>
        <Input
          id={`gy-${student.membershipId}`}
          name="expectedGraduationYear"
          type="number"
          defaultValue={student.graduationYear}
          className="w-28"
          required
        />
      </div>
      <Button type="submit" size="sm">
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function StudentRow({ student }: { student: StudentDirectoryEntry }) {
  const { editing, setEditing, state, formAction } = useStudentEditing();

  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={10}>
          <StudentEditForm student={student} state={state} formAction={formAction} onCancel={() => setEditing(false)} />
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>{student.firstName}</TableCell>
      <TableCell className="text-muted-foreground">{student.schoolEmail}</TableCell>
      <TableCell>{student.graduationYear}</TableCell>
      <TableCell>
        <Badge variant={student.status === "ACTIVE" ? "default" : "secondary"}>{STATUS_LABELS[student.status]}</Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {student.activity.questionsAnswered.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums">{student.activity.sessionsCompleted}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {formatStudyTime(student.activity.studyHours)}
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDate(student.registeredAt)}</TableCell>
      <TableCell className="text-muted-foreground">{formatDate(student.lastActiveAt)}</TableCell>
      <TableCell>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** The same student, as one stacked entry for a phone. */
function StudentListItem({ student }: { student: StudentDirectoryEntry }) {
  const { editing, setEditing, state, formAction } = useStudentEditing();

  if (editing) {
    return (
      <li className="py-3">
        <StudentEditForm student={student} state={state} formAction={formAction} onCancel={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{student.firstName}</p>
          <p className="truncate text-sm text-muted-foreground">{student.schoolEmail}</p>
        </div>
        <Badge variant={student.status === "ACTIVE" ? "default" : "secondary"}>{STATUS_LABELS[student.status]}</Badge>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-border text-sm">
        <div className="pr-3">
          <dt className="text-xs text-muted-foreground">Questions</dt>
          <dd className="tabular-nums">{student.activity.questionsAnswered.toLocaleString()}</dd>
        </div>
        <div className="px-3">
          <dt className="text-xs text-muted-foreground">Sessions</dt>
          <dd className="tabular-nums">{student.activity.sessionsCompleted}</dd>
        </div>
        <div className="pl-3">
          <dt className="text-xs text-muted-foreground">Study Time</dt>
          <dd className="tabular-nums">{formatStudyTime(student.activity.studyHours)}</dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Class of {student.graduationYear} · Last active {formatDate(student.lastActiveAt)}
        </p>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    </li>
  );
}
