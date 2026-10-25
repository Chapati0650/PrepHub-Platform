"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmButton } from "@/components/confirm-button";

export type TeacherPanelRow = {
  userId: string;
  firstName: string;
  email: string;
  activated: boolean;
  classCount: number;
  studentCount: number;
};

export type TeacherPanelState = { error?: string; success?: boolean; message?: string };

/**
 * A school's teachers: add one by email, resend an invite, remove one. Used
 * by the school's Administrator and by the Owner on the school's page, with
 * each caller's own server actions (and own authorization) passed in.
 *
 * Counts only — how many classes and students a teacher has, never anyone's
 * homework results, which belong to the teacher and the student.
 */
export function TeachersPanel({
  teachers,
  invite,
  resend,
  remove,
  hidden = {},
  readOnly = false,
}: {
  teachers: TeacherPanelRow[];
  invite: (prev: TeacherPanelState, formData: FormData) => Promise<TeacherPanelState>;
  resend: (userId: string) => Promise<TeacherPanelState>;
  remove: (userId: string) => Promise<TeacherPanelState>;
  hidden?: Record<string, string>;
  readOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState(invite, {});
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {teachers.length === 0 ? (
        <p className="rounded-2xl bg-surface-tint p-5 text-sm text-muted-foreground">
          No teachers yet. A teacher gets their own login, makes classes, gives students a code to join, and assigns
          PrepHub questions as homework.
        </p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {teachers.map((t) => (
            <li key={t.userId} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="block font-medium">
                  {t.firstName}
                  {!t.activated && <span className="ml-2 text-xs font-normal text-muted-foreground">Invited — hasn&apos;t signed in yet</span>}
                </span>
                <span className="block truncate text-muted-foreground">{t.email}</span>
              </span>
              <span className="flex shrink-0 items-center gap-4">
                <span className="text-muted-foreground tabular-nums">
                  {t.classCount} class{t.classCount === 1 ? "" : "es"} · {t.studentCount} student{t.studentCount === 1 ? "" : "s"}
                </span>
                {!readOnly && !t.activated && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={async () => {
                      const result = await resend(t.userId);
                      setNotice(result.error ?? result.message ?? `Sent a new invite to ${t.email}.`);
                    }}
                  >
                    Resend invite
                  </Button>
                )}
                {!readOnly && (
                  <ConfirmButton
                    variant="ghost"
                    size="xs"
                    title={`Remove ${t.firstName} as a teacher?`}
                    description={`${t.firstName} loses teacher access right away and their classes here close: students stop seeing that homework. Nothing is deleted — every result is kept — and adding ${t.firstName} again restores their access.`}
                    confirmLabel="Remove teacher"
                    destructive
                    onConfirm={() => remove(t.userId)}
                  >
                    Remove
                  </ConfirmButton>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      {readOnly ? (
        <p className="text-sm text-muted-foreground">This is a read-only preview. Add teachers from the school&apos;s page under Schools.</p>
      ) : (
        <form action={formAction} className="flex max-w-xl flex-col gap-3">
          <p className="text-sm font-medium">Add a teacher</p>
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          {state.success && !pending && (
            <p role="status" className="text-sm text-muted-foreground">
              {state.message ?? "Added. They'll get an email to set their password."}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="teacher-first-name">Teacher&apos;s first name</Label>
              <Input id="teacher-first-name" name="firstName" autoComplete="off" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="teacher-email">Teacher&apos;s school email</Label>
              <Input id="teacher-email" name="email" type="email" autoComplete="off" required />
            </div>
          </div>
          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? "Adding…" : "Add teacher"}
          </Button>
          <p className="text-xs text-muted-foreground">
            They get an email with a link to set their password, or can sign in with Google using that address.
          </p>
        </form>
      )}
    </div>
  );
}
