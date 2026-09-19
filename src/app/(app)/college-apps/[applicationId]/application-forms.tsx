"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import type { ApplicationPlan, ApplicationPlatform, ApplicationStatus } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PLATFORM_LABEL, PLATFORM_ORDER } from "@/lib/college-apps/platform-prompts";
import type { ParsedPrompt } from "@/lib/college-apps/parse-prompts";
import { KIND_LABEL, PLAN_LABEL, STATUS_LABEL, toDateInputValue } from "../labels";
import {
  addItemAction,
  parsePromptsAction,
  removeCollegeAction,
  saveParsedPromptsAction,
  updateApplicationAction,
  type CollegeAppsActionState,
} from "../actions";

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
          {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
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

// Paste → review → save. The parsed prompts are shown back and each can be
// removed before anything is written; the model never writes to the
// checklist unseen.
export function PastePrompts({ applicationId, collegeName }: { applicationId: string; collegeName: string }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedPrompt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();

  function parse() {
    setError(null);
    start(async () => {
      const res = await parsePromptsAction(text);
      if (res.error) setError(res.error);
      else setParsed(res.prompts ?? []);
    });
  }
  function save() {
    if (!parsed?.length) return;
    start(async () => {
      const res = await saveParsedPromptsAction(applicationId, parsed);
      if (res.error) setError(res.error);
      else {
        setSaved(true);
        setParsed(null);
        setText("");
      }
    });
  }

  return (
    <section className="rounded-2xl bg-surface-tint p-6">
      <h2 className="font-heading font-semibold">Paste {collegeName}&apos;s prompts</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Copy the supplement questions from the application (Common App → this college → Writing) and paste them here.
        PrepHub pulls out each prompt and its word limit for you to check before adding.
      </p>
      {parsed === null ? (
        <div className="mt-4 flex flex-col gap-3">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Paste the prompts here…" aria-label="Pasted prompts" className="bg-background" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm text-muted-foreground">Added to the checklist above.</p>}
          <Button type="button" onClick={parse} disabled={busy || text.trim().length < 20} className="w-fit rounded-full px-5">
            {busy ? "Reading…" : "Find the prompts"}
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm font-medium">
            Found {parsed.length} prompt{parsed.length === 1 ? "" : "s"}. Remove any that aren&apos;t right, then add.
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background">
            {parsed.map((p, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p.title}
                    {p.wordLimit && <span className="ml-2 text-xs font-normal text-muted-foreground">{p.wordLimit} words</span>}
                  </p>
                  <p className="mt-0.5 text-sm whitespace-pre-line text-muted-foreground">{p.text}</p>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${p.title}`} onClick={() => setParsed(parsed.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" onClick={save} disabled={busy || parsed.length === 0} className="rounded-full px-5">
              {busy ? "Adding…" : `Add ${parsed.length} to checklist`}
            </Button>
            <Button type="button" variant="ghost" className="rounded-full" onClick={() => setParsed(null)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </section>
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
