"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Upload, Check, X, Mail } from "lucide-react";
import {
  commitRosterAction,
  previewRosterAction,
  removeRosterEntryAction,
  sendRosterInvitesAction,
  setEnrollmentModeAction,
  type ActionState,
  type RosterInviteState,
  type RosterPreviewState,
} from "../actions";
import type { RosterListEntry } from "@/lib/owner/roster";
import type { RosterInviteSummary } from "@/lib/owner/roster-invites";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialPreview: RosterPreviewState = {};
const initialAction: ActionState = {};
const initialInvite: RosterInviteState = {};

const MODE_COPY: Record<string, { label: string; detail: string }> = {
  DOMAIN: {
    label: "Anyone on the school's email domain",
    detail: "No student data changes hands. Right for a pilot.",
  },
  ROSTER: {
    label: "Only students on the roster",
    detail: "The district controls exactly who gets access. Right for a paid contract.",
  },
  ROSTER_OR_DOMAIN: {
    label: "Roster first, then the email domain",
    detail: "For moving from one to the other without a gap.",
  },
};

export function RosterPanel({
  id,
  enrollmentMode,
  entries,
  total,
  joined,
  hasDomain,
  multiCampus,
  invites,
  matching,
  search,
}: {
  id: string;
  enrollmentMode: string;
  entries: RosterListEntry[];
  total: number;
  joined: number;
  hasDomain: boolean;
  multiCampus: boolean;
  invites: RosterInviteSummary;
  /** How many rows the current search matches; equals `total` when not searching. */
  matching: number;
  search: string;
}) {
  const [preview, previewAction, previewing] = useActionState(previewRosterAction, initialPreview);
  const [commit, commitAction, committing] = useActionState(commitRosterAction, initialAction);
  const [mode, modeAction, savingMode] = useActionState(setEnrollmentModeAction, initialAction);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // A file picker is a convenience over the textarea, not a second code path:
  // the file's text lands in the same box, so the Owner can see and correct
  // exactly what is about to be uploaded.
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
  };

  const p = preview.preview;

  return (
    <div className="flex flex-col gap-6">
      {/* Who gets in */}
      <form action={modeAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={id} />
        <Label>Who gets access</Label>
        <div className="flex flex-col gap-2">
          {Object.entries(MODE_COPY).map(([value, copy]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-surface-tint"
            >
              <input
                type="radio"
                name="enrollmentMode"
                value={value}
                defaultChecked={enrollmentMode === value}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{copy.label}</span>
                <span className="mt-0.5 block text-muted-foreground">{copy.detail}</span>
              </span>
            </label>
          ))}
        </div>
        {!hasDomain && (
          <p className="text-sm text-muted-foreground">
            No email domain is set for this organization yet, so the domain options will not match anyone.
          </p>
        )}
        {mode.error && (
          <Alert variant="destructive">
            <AlertDescription>{mode.error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" variant="outline" disabled={savingMode} className="w-fit">
          {savingMode ? "Saving..." : "Save"}
        </Button>
      </form>

      <div className="border-t border-border pt-6">
        <p className="text-sm font-medium">Upload a roster</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a list of student emails, or a CSV with columns for email, first name, graduation year
          {multiCampus ? ", and campus" : ""}. Column order and naming don&apos;t matter.
          {multiCampus && " A campus column is required because this district has more than one school."}
        </p>

        <form action={previewAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="id" value={id} />
          <textarea
            name="roster"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={
              multiCampus
                ? "email,first name,grad year,campus\nada@student.nisdtx.org,Ada,2028,Northwest High School"
                : "ada@student.nisdtx.org\nbrian@student.nisdtx.org"
            }
            className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" aria-hidden />
              Choose a file
            </Button>
            <Button type="submit" disabled={previewing || !text.trim()}>
              {previewing ? "Checking..." : "Check this roster"}
            </Button>
          </div>
        </form>

        {preview.error && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{preview.error}</AlertDescription>
          </Alert>
        )}

        {/* Nothing is written until the Owner has seen this and confirmed. */}
        {p && (
          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-border p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="To add" value={p.toAdd} />
              <Stat label="To update" value={p.toUpdate} />
              <Stat label="Left alone" value={p.untouched} />
              <Stat label="Rows rejected" value={p.errors.length} tone={p.errors.length ? "warn" : undefined} />
            </div>

            {p.headerless && (
              <p className="text-sm text-muted-foreground">
                Read as a plain list of email addresses — no header row was found.
              </p>
            )}
            {p.alreadyRegistered > 0 && (
              <p className="text-sm text-muted-foreground">
                {p.alreadyRegistered} of these already have a PrepHub account; they get school access the next
                time they open the site.
              </p>
            )}

            {p.sample.length > 0 && (
              <div>
                <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  First few rows, as read
                </p>
                <ul className="mt-2 divide-y divide-border border-y border-border text-sm">
                  {p.sample.map((s) => (
                    <li key={s.email} className="flex flex-wrap justify-between gap-2 py-2">
                      <span>{s.email}</span>
                      <span className="text-muted-foreground">
                        {[s.firstName, s.graduationYear, s.campusName].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {p.errors.length > 0 && (
              <div>
                <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Rows that will be skipped
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {p.errors.map((e) => (
                    <li key={`${e.line}-${e.value}`} className="text-muted-foreground">
                      <span className="tabular-nums">Line {e.line}</span> — {e.value || "(blank)"}: {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {commit.error && (
              <Alert variant="destructive">
                <AlertDescription>{commit.error}</AlertDescription>
              </Alert>
            )}

            {p.validCount > 0 ? (
              <form action={commitAction} className="flex items-center gap-3">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="roster" value={preview.input ?? ""} />
                <Button type="submit" disabled={committing}>
                  {committing ? "Uploading..." : `Add ${p.validCount} student${p.validCount === 1 ? "" : "s"}`}
                </Button>
                <span className="text-sm text-muted-foreground">
                  This never removes anyone already on the roster.
                </span>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">No valid rows to upload.</p>
            )}
          </div>
        )}

        {commit.success && !p && (
          <Alert className="mt-4">
            <AlertDescription>Roster updated.</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Getting them in */}
      <InvitePanel id={id} summary={invites} />

      {/* Current roster */}
      <div className="border-t border-border pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">
            On the roster <span className="text-muted-foreground tabular-nums">({total})</span>
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">{joined} have joined</p>
        </div>

        <RosterSearch initial={search} />

        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {search
              ? `Nobody on this roster matches "${search}".`
              : "Nobody yet. Upload a roster above."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border border-y border-border text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className={e.removedAt ? "text-muted-foreground line-through" : ""}>
                  {e.email}
                  <span className="ml-2 text-muted-foreground">
                    {[e.firstName, e.graduationYear, e.campusName].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {e.joined ? (
                    <Badge variant="secondary" className="gap-1">
                      <Check className="size-3" aria-hidden />
                      Joined
                    </Badge>
                  ) : (
                    <Badge variant="outline">Not yet</Badge>
                  )}
                  {!e.removedAt && (
                    <form action={removeRosterEntryAction}>
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="entryId" value={e.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${e.email} from the roster`}
                      >
                        <X className="size-4" aria-hidden />
                      </Button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {matching > entries.length && (
          <p className="mt-2 text-sm text-muted-foreground tabular-nums">
            Showing the first {entries.length} of {matching.toLocaleString()}
            {search ? ` matching "${search}"` : ""}. Narrow the search to find someone further down.
          </p>
        )}
        {search && matching <= entries.length && (
          <p className="mt-2 text-sm text-muted-foreground tabular-nums">
            {matching.toLocaleString()} of {total.toLocaleString()} match &ldquo;{search}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div>
      <p className={`font-heading text-2xl font-semibold tabular-nums ${tone === "warn" && value > 0 ? "text-destructive" : ""}`}>
        {value}
      </p>
      <p className="text-caption tracking-[0.12em] text-muted-foreground uppercase">{label}</p>
    </div>
  );
}

/**
 * Inviting the roster.
 *
 * Two separate buttons, not one with a checkbox: the first invitation and
 * chasing the people who ignored it are different decisions, and the count on
 * each button is what makes which one you are about to do unambiguous. Both
 * are capped per click, so the panel says what is left rather than pretending
 * one press covered a district.
 */
function InvitePanel({ id, summary }: { id: string; summary: RosterInviteSummary }) {
  const [state, action, pending] = useActionState(sendRosterInvitesAction, initialInvite);

  return (
    <div className="border-t border-border pt-6">
      <p className="text-sm font-medium">Invite them</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Emails every student on the roster who hasn&apos;t claimed their access, asking them to sign up
        with their school address. No account or password is ever created for them.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Awaiting claim" value={summary.awaitingClaim} />
        <Stat label="Never invited" value={summary.neverInvited} />
        <Stat label="Invited already" value={summary.alreadyInvited} />
      </div>

      {summary.lastInvitedAt && (
        <p className="mt-3 text-sm text-muted-foreground">
          Last invitation sent{" "}
          {new Date(summary.lastInvitedAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
          .
        </p>
      )}

      {state.error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {state.success && (
        <Alert className="mt-4">
          <AlertDescription>
            {state.queued === 0
              ? "Nobody was waiting on an invitation."
              : `Queued ${state.queued} invitation${state.queued === 1 ? "" : "s"}.${
                  state.remaining ? ` ${state.remaining} still to go — send again to continue.` : ""
                }`}
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" disabled={pending || summary.neverInvited === 0}>
            <Mail className="size-4" aria-hidden />
            {pending ? "Sending..." : `Invite ${summary.neverInvited} student${summary.neverInvited === 1 ? "" : "s"}`}
          </Button>
        </form>

        {summary.alreadyInvited > 0 && (
          <form action={action}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="reminder" value="1" />
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Sending..." : `Remind all ${summary.awaitingClaim} unclaimed`}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Debounced search over the roster, kept in the URL.
 *
 * The same shape as the Student Directory's search for the same reason: a
 * district roster is thousands of rows, the list shows the first few hundred,
 * and the student somebody is calling about is almost never in them.
 */
function RosterSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (value === initial) return;
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) params.set("roster", value.trim());
      else params.delete("roster");
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="mt-3">
      <Label htmlFor="roster-search" className="sr-only">
        Search the roster
      </Label>
      <Input
        id="roster-search"
        placeholder="Search by email or first name…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full sm:w-80"
      />
    </div>
  );
}
