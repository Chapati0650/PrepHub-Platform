"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmButton } from "@/components/confirm-button";
import { StaffField, StatusChip } from "@/components/staff/staff-ui";

export type TeacherPanelRow = {
  userId: string;
  firstName: string;
  email: string;
  activated: boolean;
  classCount: number;
  studentCount: number;
};

export type TeacherPanelState = { error?: string; success?: boolean; message?: string };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * A school's teachers: add one by email, resend an invite, remove one. Used
 * by the school's Administrator and by the Owner on the school's page, with
 * each caller's own server actions (and own authorization) passed in.
 *
 * Counts only — how many classes and students a teacher has, never anyone's
 * homework results, which belong to the teacher and the student.
 *
 * Laid out for the staff pages (2026-10-25): each teacher on one line with
 * their status said in words, the form saying what happens after you press
 * the button, and controls at the staff size.
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
    <div className="flex flex-col gap-8">
      <section aria-labelledby="teacher-list-heading" className="flex flex-col gap-4">
        <h2 id="teacher-list-heading" className="text-xl">
          {teachers.length === 0 ? "Your teachers" : `Your teachers (${teachers.length})`}
        </h2>
        {teachers.length === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-6 text-base text-muted-foreground">
            No teachers yet. Add the first one below: each teacher gets their own login, makes classes, gives
            students a code to join, and assigns PrepHub questions as homework.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {teachers.map((t) => (
              <li key={t.userId} className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
                <span
                  aria-hidden
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted font-heading text-base font-semibold"
                >
                  {t.firstName.trim().slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-lg font-medium">{t.firstName}</span>
                    {t.activated ? (
                      <StatusChip tone="good">Signed in</StatusChip>
                    ) : (
                      <StatusChip tone="warn">Invited, hasn&apos;t signed in yet</StatusChip>
                    )}
                  </p>
                  <p className="truncate text-base text-muted-foreground">{t.email}</p>
                </div>
                <p className="text-base tabular-nums lg:w-48 lg:text-right">
                  {plural(t.classCount, "class", "classes")} · {plural(t.studentCount, "student")}
                </p>
                {!readOnly && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {!t.activated && (
                      <Button
                        variant="outline"
                        size="xl"
                        onClick={async () => {
                          const result = await resend(t.userId);
                          setNotice(result.error ?? result.message ?? `Sent ${t.firstName} a new invitation email.`);
                        }}
                      >
                        Resend invitation
                      </Button>
                    )}
                    <ConfirmButton
                      variant="ghost"
                      size="xl"
                      title={`Remove ${t.firstName} as a teacher?`}
                      description={`${t.firstName} loses teacher access right away and their classes here close: students stop seeing that homework. Nothing is deleted — every result is kept — and adding ${t.firstName} again restores their access and reopens those classes.`}
                      confirmLabel="Remove teacher"
                      destructive
                      onConfirm={() => remove(t.userId)}
                    >
                      Remove
                    </ConfirmButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {notice && (
          <p role="status" className="text-base text-muted-foreground">
            {notice}
          </p>
        )}
      </section>

      {readOnly ? (
        <p className="text-base text-muted-foreground">
          This is a read-only preview. Add teachers from the school&apos;s page under Schools.
        </p>
      ) : (
        <section aria-labelledby="add-teacher-heading" className="rounded-2xl border border-border p-5 sm:p-6">
          <h2 id="add-teacher-heading" className="text-xl">
            Add a teacher
          </h2>
          <p className="mt-1 max-w-2xl text-base text-muted-foreground">
            PrepHub emails them straight away with a link to set their password. The link lasts a week, and you can
            resend it from the list above. If your school uses Google, they can also just choose &ldquo;Continue with
            Google&rdquo; with this email address.
          </p>
          <form action={formAction} className="mt-5 flex flex-col gap-4">
            {Object.entries(hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            {state.error && (
              <Alert variant="destructive">
                <AlertDescription className="text-base">{state.error}</AlertDescription>
              </Alert>
            )}
            {state.success && !pending && (
              <Alert>
                <AlertDescription className="text-base">
                  {state.message ?? "Added. They'll get an email from PrepHub to set their password."}
                </AlertDescription>
              </Alert>
            )}
            <div className="grid gap-4 sm:grid-cols-[1fr_1.5fr]">
              <StaffField label="Teacher's first name" htmlFor="teacher-first-name">
                <Input id="teacher-first-name" name="firstName" autoComplete="off" required className="h-11 text-base md:text-base" />
              </StaffField>
              <StaffField label="Teacher's school email" htmlFor="teacher-email">
                <Input
                  id="teacher-email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  required
                  placeholder="name@yourschool.org"
                  className="h-11 text-base md:text-base"
                />
              </StaffField>
            </div>
            <Button type="submit" size="xl" disabled={pending} className="w-fit">
              {pending ? "Adding…" : "Add teacher"}
            </Button>
          </form>
        </section>
      )}
    </div>
  );
}
