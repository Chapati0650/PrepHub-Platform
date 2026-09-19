"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSupplementAction, updateSupplementAction, type SupplementActionState } from "../actions";

const initial: SupplementActionState = {};

// One form for both create and edit. Controlled fields, for the same reason
// as the lesson editor: a save re-renders the page with fresh props, and
// Base UI warns when an uncontrolled field's defaultValue changes under it.
export function SupplementForm({
  collegeId,
  cycle,
  existing,
}: {
  collegeId: number;
  cycle: number;
  existing: { id: string; title: string; promptText: string; wordLimit: number | null } | null;
}) {
  const [state, action, pending] = useActionState(existing ? updateSupplementAction : createSupplementAction, initial);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [promptText, setPromptText] = useState(existing?.promptText ?? "");
  const [wordLimit, setWordLimit] = useState(existing?.wordLimit ? String(existing.wordLimit) : "");
  const uid = existing?.id ?? "new";

  return (
    <form
      action={(fd) => {
        action(fd);
        if (!existing) {
          setTitle("");
          setPromptText("");
          setWordLimit("");
        }
      }}
      className="flex flex-col gap-3"
    >
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input type="hidden" name="collegeId" value={collegeId} />
      <input type="hidden" name="cycle" value={cycle} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_7rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`title-${uid}`}>Title</Label>
          <Input id={`title-${uid}`} name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder='e.g. "Why Rice?"' required maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`limit-${uid}`}>Word limit</Label>
          <Input id={`limit-${uid}`} name="wordLimit" type="number" min={1} value={wordLimit} onChange={(e) => setWordLimit(e.target.value)} placeholder="—" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`prompt-${uid}`}>Prompt text</Label>
        <Textarea id={`prompt-${uid}`} name="promptText" value={promptText} onChange={(e) => setPromptText(e.target.value)} rows={existing ? 3 : 4} required maxLength={4000} />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant={existing ? "outline" : "default"} className="rounded-full" disabled={pending}>
          {pending ? "Saving…" : existing ? "Save changes" : "Add prompt"}
        </Button>
        {state.saved && !pending && <span className="text-sm text-muted-foreground">Saved.</span>}
      </div>
    </form>
  );
}
