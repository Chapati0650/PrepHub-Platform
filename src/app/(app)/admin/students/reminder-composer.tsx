"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StaffField } from "@/components/staff/staff-ui";
import {
  REMINDER_COOLDOWN_DAYS,
  REMINDER_MESSAGE_MAX,
  REMINDER_SUBJECT_MAX,
  defaultReminder,
  reminderEmail,
  type ReminderTemplate,
} from "@/lib/admin/reminder-message";
import { isStaleServerActionError } from "@/lib/stale-build";
import {
  previewRemindersAction,
  sendRemindersAction,
  type ReminderPreviewResult,
  type ReminderRequest,
  type ReminderSendResult,
} from "./actions";

function students(n: number): string {
  return `${n.toLocaleString()} student${n === 1 ? "" : "s"}`;
}

/**
 * "Email these students": the button and the dialog behind it (2026-11-14).
 *
 * The dialog says who it goes to and who it skips before anything is sent
 * (counted on the server, from the same rule the send uses), starts from
 * wording that fits the list it was opened from, and shows the email exactly
 * as one student will get it. Nothing is sent until "Send to N students".
 */
export function ReminderComposer({
  request,
  count,
  audience,
  template,
  schoolName,
  senderName,
  sampleFirstName,
  label,
  primary,
  initialOpen = false,
  initialPreview = null,
  onClosed,
}: {
  request: ReminderRequest;
  /** How many the list holds; the dialog's own count says how many it will reach. */
  count: number;
  /** "the 11 students who haven't started yet" */
  audience: string;
  template: ReminderTemplate;
  schoolName: string;
  senderName: string;
  sampleFirstName: string;
  label: string;
  /** The list is one a reminder is the obvious next step for. */
  primary: boolean;
  initialOpen?: boolean;
  initialPreview?: ReminderPreviewResult | null;
  onClosed?: () => void;
}) {
  const router = useRouter();
  const defaults = defaultReminder(template, schoolName);
  const [open, setOpen] = useState(initialOpen);
  const [subject, setSubject] = useState(defaults.subject);
  const [message, setMessage] = useState(defaults.message);
  const [preview, setPreview] = useState<ReminderPreviewResult | null>(initialPreview);
  const [result, setResult] = useState<ReminderSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counting, startCounting] = useTransition();
  const [sending, startSending] = useTransition();

  function countAudience() {
    setPreview(null);
    startCounting(async () => {
      try {
        setPreview(await previewRemindersAction(request));
      } catch (err) {
        setPreview({
          error: isStaleServerActionError(err)
            ? "PrepHub was just updated. Reload the page, then try again."
            : "Couldn't count the students just now. Close this and try again.",
        });
      }
    });
  }

  function openComposer() {
    const fresh = defaultReminder(template, schoolName);
    setSubject(fresh.subject);
    setMessage(fresh.message);
    setResult(null);
    setError(null);
    setOpen(true);
    countAudience();
  }

  function close() {
    setOpen(false);
    if (result?.sent) router.refresh();
    onClosed?.();
  }

  function send() {
    setError(null);
    startSending(async () => {
      try {
        const r = await sendRemindersAction({ ...request, subject, message });
        if (r.error) setError(r.error);
        else setResult(r);
      } catch (err) {
        setError(
          isStaleServerActionError(err)
            ? "PrepHub was just updated. Reload the page, then try again. Nothing was sent."
            : "Something went wrong and nothing was sent. Try again in a moment.",
        );
      }
    });
  }

  const eligible = preview?.preview?.eligible ?? 0;
  const sample = reminderEmail({ firstName: sampleFirstName, schoolName, senderName, subject, message, site: "https://prephubtp.com" });

  return (
    <>
      <Button size="xl" variant={primary ? "default" : "outline"} onClick={openComposer} disabled={count === 0}>
        <Mail aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="max-h-[92dvh] gap-6 overflow-y-auto p-6 text-base sm:max-w-2xl sm:p-8">
          {result ? (
            <SentView result={result} onDone={close} />
          ) : (
            <>
              <DialogHeader className="gap-2">
                <DialogTitle className="text-2xl">Email {students(count)}</DialogTitle>
                <DialogDescription className="text-lg text-foreground/75">
                  A reminder to {audience}, sent to each one&apos;s school email with their own first name.
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-2xl bg-surface-tint p-5" role="status" aria-live="polite">
                {counting || !preview ? (
                  <p className="text-lg">Checking who this will reach…</p>
                ) : preview.error ? (
                  <p className="text-lg">{preview.error}</p>
                ) : (
                  <>
                    <p className="text-lg font-medium">
                      {eligible === 0 ? "Nobody in this list can be emailed right now." : `${students(eligible)} will get this email.`}
                    </p>
                    {(preview.preview?.recentlyReminded ?? 0) > 0 && (
                      <p className="mt-1 text-base text-foreground/75">
                        {students(preview.preview!.recentlyReminded)} skipped: already sent a reminder in the last{" "}
                        {REMINDER_COOLDOWN_DAYS} days.
                      </p>
                    )}
                    {(preview.preview?.noAccess ?? 0) > 0 && (
                      <p className="mt-1 text-base text-foreground/75">
                        {students(preview.preview!.noAccess)} skipped: no longer {preview.preview!.noAccess === 1 ? "has" : "have"}{" "}
                        access through the school.
                      </p>
                    )}
                  </>
                )}
              </div>

              <StaffField label="Subject" htmlFor="reminder-subject">
                <Input
                  id="reminder-subject"
                  value={subject}
                  maxLength={REMINDER_SUBJECT_MAX}
                  onChange={(e) => setSubject(e.target.value)}
                  className="h-11 text-base md:text-base"
                />
              </StaffField>
              <StaffField
                label="Message"
                htmlFor="reminder-message"
                hint="Written for this list. Change anything you like; each email starts with the student's first name and ends with yours."
              >
                <Textarea
                  id="reminder-message"
                  value={message}
                  maxLength={REMINDER_MESSAGE_MAX}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={7}
                  className="min-h-40 px-3 py-2.5 text-base leading-relaxed md:text-base"
                />
              </StaffField>

              <section aria-labelledby="reminder-preview-heading" className="flex flex-col gap-3">
                <h3 id="reminder-preview-heading" className="text-lg">
                  What {sampleFirstName} will get
                </h3>
                <div className="overflow-hidden rounded-2xl border border-border">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-border bg-muted/40 px-5 py-3 text-base">
                    <dt className="text-muted-foreground">From</dt>
                    <dd>PrepHub, for {schoolName}</dd>
                    <dt className="text-muted-foreground">Subject</dt>
                    <dd className="font-medium break-words">{sample.subject || "(no subject)"}</dd>
                  </dl>
                  <p className="px-5 py-4 text-base leading-relaxed break-words whitespace-pre-wrap">{sample.text}</p>
                </div>
              </section>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription className="text-base">{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-end">
                <Button variant="ghost" size="xl" onClick={close} disabled={sending}>
                  Cancel
                </Button>
                <Button size="xl" onClick={send} disabled={sending || counting || eligible === 0 || !subject.trim() || !message.trim()}>
                  <Mail aria-hidden />
                  {sending ? "Sending…" : eligible > 0 ? `Send to ${students(eligible)}` : "Send"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SentView({ result, onDone }: { result: ReminderSendResult; onDone: () => void }) {
  const demo = result.demoWouldSend !== undefined;
  return (
    <>
      <DialogHeader className="gap-2">
        <DialogTitle className="text-2xl">{demo ? "Nothing was sent: this is a demo login" : `Sent to ${students(result.sent ?? 0)}`}</DialogTitle>
        <DialogDescription className="text-lg leading-relaxed text-foreground/75">
          {demo
            ? `On your own school's account, ${students(result.demoWouldSend ?? 0)} would get this email now, and the list would show “Reminded today” beside each one.`
            : `It will be in their inboxes within a few minutes. The list now shows “Reminded today” beside each one, and this page won't send them another reminder for ${REMINDER_COOLDOWN_DAYS} days.`}
        </DialogDescription>
      </DialogHeader>
      {!demo && (result.recentlyReminded ?? 0) > 0 && (
        <p className="text-base text-muted-foreground">
          {students(result.recentlyReminded!)} skipped because they were reminded in the last {REMINDER_COOLDOWN_DAYS} days.
        </p>
      )}
      <div className="flex justify-end border-t border-border pt-5">
        <Button size="xl" onClick={onDone}>
          Done
        </Button>
      </div>
    </>
  );
}
