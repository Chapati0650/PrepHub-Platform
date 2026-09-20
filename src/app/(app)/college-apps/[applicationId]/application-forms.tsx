"use client";

import { startTransition, useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ApplicationPlan, ApplicationPlatform, ApplicationStatus } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PLATFORM_LABEL, PLATFORM_ORDER } from "@/lib/college-apps/platform-prompts";
import { KIND_LABEL, PLAN_LABEL, STATUS_LABEL, toDateInputValue } from "../labels";
import { addItemAction, removeCollegeAction, updateApplicationAction, type CollegeAppsActionState } from "../actions";

const initial: CollegeAppsActionState = {};
const selectClass = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm";

export function ApplicationForm({
  applicationId,
  initial: init,
}: {
  applicationId: string;
  initial: { platform: ApplicationPlatform | null; plan: ApplicationPlan | null; status: ApplicationStatus; deadline: Date | null; notes: string };
}) {
  const [state, action, pending] = useActionState(updateApplicationAction, initial);
  // Controlled, for two reasons found by screenshot: a native <select> with a
  // default value ignores a changed default after mount, so Status/Plan kept
  // showing the pre-save values after a successful save; and Base UI warns
  // when an uncontrolled field's default changes under it.
  const [status, setStatus] = useState<ApplicationStatus>(init.status);
  const [plan, setPlan] = useState(init.plan ?? "");
  const [platform, setPlatform] = useState(init.platform ?? "");
  const [deadline, setDeadline] = useState(toDateInputValue(init.deadline));
  const [notes, setNotes] = useState(init.notes);
  return (
    // onSubmit + startTransition rather than <form action>: React 19 resets a
    // form automatically after an `action` prop completes, and a reset puts
    // a <select> back on its first <option> while React's controlled state
    // still holds the saved value — the DOM said "Researching" right after
    // saving "Submitted" (confirmed in a real browser). Text inputs survive
    // a reset because React syncs their value attribute; selects don't.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="applicationId" value={applicationId} />
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <select id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)} className={selectClass}>
            {(Object.keys(STATUS_LABEL) as ApplicationStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan">Plan</Label>
          <select id="plan" name="plan" value={plan} onChange={(e) => setPlan(e.target.value)} className={selectClass}>
            <option value="">—</option>
            {(Object.keys(PLAN_LABEL) as ApplicationPlan[]).map((p) => (
              <option key={p} value={p}>
                {PLAN_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deadline">Deadline</Label>
          <Input id="deadline" name="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platform">Platform</Label>
          <select id="platform" name="platform" value={platform} onChange={(e) => setPlatform(e.target.value)} className={selectClass}>
            <option value="">—</option>
            {PLATFORM_ORDER.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={4000} placeholder="Interview date, portal login, who you talked to…" />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="rounded-full px-5">
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.saved && !pending && <span className="text-sm text-muted-foreground">Saved.</span>}
      </div>
    </form>
  );
}

export function AddItemForm({ applicationId }: { applicationId: string | null }) {
  const [state, action, pending] = useActionState(addItemAction, initial);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("OTHER");
  const [wordLimit, setWordLimit] = useState("");
  const [detail, setDetail] = useState("");
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setOpen(true)}>
        Add an item
      </Button>
    );
  }
  return (
    // Stays open after a successful add — a senior adding three recommenders
    // shouldn't reopen it three times — but the fields clear.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
        setTitle("");
        setWordLimit("");
        setDetail("");
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="applicationId" value={applicationId ?? ""} />
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.saved && !pending && <p className="text-sm text-muted-foreground">Added.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem_7rem]">
        <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ask Ms. Rivera for a recommendation" required maxLength={200} aria-label="Item" />
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={selectClass} aria-label="Kind">
          {/* No "Essay" here: a college's prompts come from the Owner's
              curation, so a student never types one in. */}
          {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[])
            .filter((k) => k !== "PROMPT")
            .map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
        </select>
        <Input name="wordLimit" type="number" min={1} value={wordLimit} onChange={(e) => setWordLimit(e.target.value)} placeholder="Words" aria-label="Word limit" />
      </div>
      <Textarea name="detail" value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} maxLength={4000} placeholder="Prompt text or details (optional)" aria-label="Details" />
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="rounded-full" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function RemoveCollegeButton({ applicationId, collegeName }: { applicationId: string; collegeName: string }) {
  return (
    <form action={removeCollegeAction}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          if (!window.confirm(`Remove ${collegeName} from your list? Its checklist and your progress on it are deleted. This cannot be undone.`)) e.preventDefault();
        }}
      >
        <Trash2 className="size-4" />
        Remove
      </Button>
    </form>
  );
}
