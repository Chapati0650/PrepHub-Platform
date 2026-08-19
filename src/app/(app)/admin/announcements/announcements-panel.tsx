"use client";

import { useActionState, useState } from "react";
import { Megaphone } from "lucide-react";
import { publishAnnouncementAction, removeAnnouncementAction, type ActionState } from "./actions";
import type { AnnouncementEntry } from "@/lib/announcements";
import { useCloseDialogOnSuccess } from "@/hooks/use-close-dialog-on-success";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/empty-state";

const initialState: ActionState = {};

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function AnnouncementsPanel({ announcements }: { announcements: AnnouncementEntry[] }) {
  const active = announcements.filter((a) => a.isActive);
  const previous = announcements.filter((a) => !a.isActive);

  return (
    <div className="flex flex-col gap-8">
      <CreateAnnouncementForm />

      <div>
        <h2 className="mb-3 text-sm font-semibold">Active Announcements</h2>
        {active.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No announcements have been published."
            description="Create an announcement to share an update with your registered students."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {active.map((a) => (
              <AnnouncementCard key={a.id} announcement={a} removable />
            ))}
          </div>
        )}
      </div>

      {previous.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold">Previous Announcements</h2>
          <div className="flex flex-col gap-3">
            {previous.map((a) => (
              <AnnouncementCard key={a.id} announcement={a} removable={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AnnouncementCard({ announcement, removable }: { announcement: AnnouncementEntry; removable: boolean }) {
  const [state, formAction, pending] = useActionState(removeAnnouncementAction, initialState);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{announcement.title}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{announcement.message}</p>
        </div>
        {!announcement.isActive && (
          <Badge variant="secondary">{announcement.removedAt ? "Removed" : "Expired"}</Badge>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Published {formatDate(announcement.publishedAt)}</span>
        {announcement.expiresAt && <span>Expires {formatDate(announcement.expiresAt)}</span>}
      </div>
      {removable && (
        <form action={formAction} className="mt-3">
          <input type="hidden" name="announcementId" value={announcement.id} />
          {state.error && (
            <Alert variant="destructive" className="mb-2">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Removing…" : "Remove"}
          </Button>
        </form>
      )}
    </div>
  );
}

function CreateAnnouncementForm() {
  const [state, formAction, pending] = useActionState(publishAnnouncementAction, initialState);
  const [previewing, setPreviewing] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  // A successful publish clears the form back to its blank starting point —
  // adjusted during render (per this codebase's set-state-in-effect
  // convention) rather than in a useEffect. `useCloseDialogOnSuccess` only
  // invokes this callback (with `false`, its "closed" signal) once, exactly
  // when `state.success` flips to true, so the argument itself is unused.
  useCloseDialogOnSuccess(state.success, () => {
    setTitle("");
    setMessage("");
    setExpiresAt("");
    setPreviewing(false);
  });

  if (previewing) {
    return (
      <div className="rounded-lg border border-border p-4">
        <p className="mb-3 text-sm font-semibold text-muted-foreground">Preview</p>
        <div className="rounded-md bg-muted p-4">
          <p className="font-medium">{title}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{message}</p>
        </div>
        {expiresAt && <p className="mt-2 text-xs text-muted-foreground">Expires {expiresAt}</p>}

        <form action={formAction} className="mt-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="title" value={title} />
          <input type="hidden" name="message" value={message} />
          <input type="hidden" name="expiresAt" value={expiresAt} />
          {state.error && (
            <Alert variant="destructive" className="w-full">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Publishing…" : "Publish"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setPreviewing(false)} disabled={pending}>
            Back to Edit
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Publishing emails this announcement once to every registered student at their school email.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="mb-3 text-sm font-semibold">New Announcement</p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ann-title">Title</Label>
          <Input id="ann-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ann-message">Message</Label>
          <Textarea
            id="ann-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
            rows={4}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ann-expires">Expiration Date (optional)</Label>
          <Input id="ann-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-48" />
        </div>
        <div>
          <Button
            type="button"
            disabled={!title.trim() || !message.trim()}
            onClick={() => setPreviewing(true)}
          >
            Preview
          </Button>
        </div>
      </div>
    </div>
  );
}
