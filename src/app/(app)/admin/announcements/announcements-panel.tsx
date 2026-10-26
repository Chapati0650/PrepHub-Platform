"use client";

import { useActionState, useState } from "react";
import { publishAnnouncementAction, removeAnnouncementAction, type ActionState } from "./actions";
import type { AnnouncementEntry } from "@/lib/announcements";
import { useCloseDialogOnSuccess } from "@/hooks/use-close-dialog-on-success";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmButton } from "@/components/confirm-button";
import { StaffField, StatusChip } from "@/components/staff/staff-ui";
import { endOfLocalDay, formatLongLocalDate } from "@/lib/community/local-day";

const initialState: ActionState = {};

const TITLE_MAX = 200;
const MESSAGE_MAX = 5000;

// Every date here is a calendar day in the school's time zone — the zone the
// end date is stored in (end of that day, Central). Formatting without one
// rendered "until Nov 4" on the server (UTC) for an announcement that runs
// through Nov 5, and the browser then disagreed with it.
const formatDate = formatLongLocalDate;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function AnnouncementsPanel({
  announcements,
  schoolName,
  recipients,
  readOnly,
  today,
}: {
  announcements: AnnouncementEntry[];
  schoolName: string;
  recipients: number;
  readOnly: boolean;
  /** Today's date at the school (`YYYY-MM-DD`, Central), the earliest end date allowed. */
  today: string;
}) {
  const active = announcements.filter((a) => a.isActive);
  const previous = announcements.filter((a) => !a.isActive);

  return (
    <div className="flex flex-col gap-10">
      {readOnly ? (
        <p className="text-base text-muted-foreground">
          This is a read-only preview, so announcements can&apos;t be sent from here.
        </p>
      ) : (
        <CreateAnnouncementForm schoolName={schoolName} recipients={recipients} today={today} />
      )}

      <section aria-labelledby="active-announcements-heading" className="flex flex-col gap-4">
        <h2 id="active-announcements-heading" className="text-xl">
          Showing to students now
        </h2>
        {active.length === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-6 text-base text-muted-foreground">
            No announcements are showing right now. Anything you send appears here until it ends or you remove it.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {active.map((a) => (
              <AnnouncementCard key={a.id} announcement={a} removable={!readOnly} />
            ))}
          </ul>
        )}
      </section>

      {previous.length > 0 && (
        <section aria-labelledby="previous-announcements-heading" className="flex flex-col gap-4">
          <h2 id="previous-announcements-heading" className="text-xl">
            Earlier announcements
          </h2>
          <ul className="flex flex-col gap-4">
            {previous.map((a) => (
              <AnnouncementCard key={a.id} announcement={a} removable={false} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AnnouncementCard({ announcement, removable }: { announcement: AnnouncementEntry; removable: boolean }) {
  return (
    <li className="rounded-2xl border border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-lg font-medium">{announcement.title}</p>
        {announcement.isActive ? (
          <StatusChip tone="good">Showing</StatusChip>
        ) : (
          <StatusChip tone="muted">{announcement.removedAt ? "Removed" : "Ended"}</StatusChip>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-base text-muted-foreground">{announcement.message}</p>
      <p className="mt-3 text-sm text-muted-foreground">
        Sent {formatDate(announcement.publishedAt)}
        {announcement.expiresAt && ` · ${announcement.isActive ? "Showing through" : "Ran until"} ${formatDate(announcement.expiresAt)}`}
      </p>
      {removable && (
        <ConfirmButton
          className="mt-4"
          size="xl"
          title="Remove this announcement?"
          description="Students stop seeing it on their PrepHub home page right away. The email that already went out can't be taken back. You'll still see it here, under Earlier announcements."
          confirmLabel="Remove announcement"
          destructive
          onConfirm={async () => {
            const fd = new FormData();
            fd.set("announcementId", announcement.id);
            return removeAnnouncementAction({}, fd);
          }}
        >
          Remove
        </ConfirmButton>
      )}
    </li>
  );
}

function CreateAnnouncementForm({ schoolName, recipients, today }: { schoolName: string; recipients: number; today: string }) {
  const [state, formAction, pending] = useActionState(publishAnnouncementAction, initialState);
  const [previewing, setPreviewing] = useState(false);
  const [sent, setSent] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  // A successful send clears the form back to its blank starting point —
  // adjusted during render (per this codebase's set-state-in-effect
  // convention) rather than in a useEffect. `useCloseDialogOnSuccess` only
  // invokes this callback once, exactly when `state.success` flips to true.
  useCloseDialogOnSuccess(state.success, () => {
    setTitle("");
    setMessage("");
    setExpiresAt("");
    setPreviewing(false);
    setSent(true);
  });

  if (previewing) {
    return (
      <section aria-labelledby="preview-heading" className="flex flex-col gap-5 rounded-2xl border-2 border-marker/60 p-5 sm:p-6">
        <div>
          <h2 id="preview-heading" className="text-xl">
            Check it before you send
          </h2>
          <p className="mt-1 text-base text-muted-foreground">This is exactly what students will get.</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-base font-medium">On every student&apos;s PrepHub home page</p>
            {/* The same box the student dashboard draws (home/page.tsx's AnnouncementsBanner). */}
            <div className="rounded-lg border border-border bg-muted/50 p-3 text-left text-sm">
              <p className="font-medium">{title}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{message}</p>
            </div>
            {expiresAt && endOfLocalDay(expiresAt) && (
              <p className="text-sm text-muted-foreground">Showing through {formatDate(endOfLocalDay(expiresAt)!)}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-base font-medium">In their school email</p>
            <div className="rounded-lg border border-border p-3 text-sm">
              <p>
                <span className="text-muted-foreground">Subject:</span>{" "}
                <span className="font-medium">
                  {schoolName}: {title}
                </span>
              </p>
              <p className="mt-2 whitespace-pre-wrap">{message}</p>
              <p className="mt-2 text-muted-foreground">— Distributed through PrepHub on behalf of {schoolName}.</p>
            </div>
          </div>
        </div>

        <p className="text-base font-medium">
          This goes to {plural(recipients, "student")} once. An email can&apos;t be unsent.
        </p>

        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="title" value={title} />
          <input type="hidden" name="message" value={message} />
          <input type="hidden" name="expiresAt" value={expiresAt} />
          {state.error && (
            <Alert variant="destructive" className="w-full">
              <AlertDescription className="text-base">{state.error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="xl" disabled={pending}>
            {pending ? "Sending…" : `Send to ${plural(recipients, "student")}`}
          </Button>
          <Button type="button" variant="outline" size="xl" onClick={() => setPreviewing(false)} disabled={pending}>
            Go back and edit
          </Button>
        </form>
      </section>
    );
  }

  return (
    <section aria-labelledby="new-announcement-heading" className="flex flex-col gap-5 rounded-2xl border border-border p-5 sm:p-6">
      <div>
        <h2 id="new-announcement-heading" className="text-xl">
          Write an announcement
        </h2>
        <p className="mt-1 text-base text-muted-foreground">
          Keep it short: a title and a few sentences. You&apos;ll see exactly what students get before anything is sent.
        </p>
      </div>

      {sent && (
        <Alert>
          <AlertDescription className="text-base">
            Sent. It&apos;s on students&apos; home pages now, and the emails are on their way.
          </AlertDescription>
        </Alert>
      )}

      <StaffField label="Title" htmlFor="ann-title" hint={`${title.length} of ${TITLE_MAX} characters`}>
        <Input
          id="ann-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSent(false);
          }}
          maxLength={TITLE_MAX}
          placeholder="e.g. School SAT Day is coming up"
          className="h-11 text-base md:text-base"
          required
        />
      </StaffField>
      <StaffField label="Message" htmlFor="ann-message" hint={`${message.length.toLocaleString()} of ${MESSAGE_MAX.toLocaleString()} characters`}>
        <Textarea
          id="ann-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={MESSAGE_MAX}
          rows={6}
          placeholder="What students need to know, and what to do about it."
          className="text-base"
          required
        />
      </StaffField>
      <StaffField
        label="Stop showing it after"
        htmlFor="ann-expires"
        optional
        hint="It stays on students' home pages through the end of this day, Central time. Leave it empty to keep it up until you remove it."
      >
        <Input
          id="ann-expires"
          type="date"
          min={today}
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="h-11 w-fit text-base md:text-base"
        />
      </StaffField>
      <Button
        type="button"
        size="xl"
        className="w-fit"
        disabled={!title.trim() || !message.trim()}
        onClick={() => setPreviewing(true)}
      >
        Preview before sending
      </Button>
    </section>
  );
}
