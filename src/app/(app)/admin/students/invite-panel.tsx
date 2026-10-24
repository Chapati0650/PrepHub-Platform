"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { sendCampusInvitesAction, type InviteState } from "./actions";
import type { RosterInviteSummary } from "@/lib/owner/roster-invites";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: InviteState = {};

/**
 * Chasing the students on the campus roster who haven't signed up yet.
 *
 * This is the one part of a launch week the product can automate: the rest
 * (the homeroom session, the follow-ups in person) is staffing. Two buttons
 * rather than one with a checkbox, because a first invitation and a reminder
 * to people who ignored one are different decisions, and the count on each
 * is what makes clear which you are about to do.
 *
 * Hidden entirely when the campus has no roster — a school on email-domain
 * enrollment has nobody to invite, and an empty panel with two dead buttons
 * would just raise a question with no answer.
 */
export function CampusInvitePanel({
  summary,
  readOnly,
}: {
  summary: RosterInviteSummary;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(sendCampusInvitesAction, initialState);

  if (summary.awaitingClaim === 0 && summary.alreadyInvited === 0) return null;

  return (
    <div className="rounded-2xl border border-border p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Students who haven&apos;t signed up</h2>
        <p className="text-sm text-muted-foreground tabular-nums">
          {summary.awaitingClaim.toLocaleString()} of your roster
        </p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        We&apos;ll email them at their school address asking them to create an account. No account or
        password is created on their behalf.
        {summary.lastInvitedAt &&
          ` Last sent ${new Date(summary.lastInvitedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}.`}
      </p>

      {state.error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {state.success && (
        <Alert className="mt-4">
          <AlertDescription>
            {!state.queued
              ? "Nobody was waiting on an invitation."
              : `Sending ${state.queued.toLocaleString()} invitation${state.queued === 1 ? "" : "s"}.${
                  state.remaining ? ` ${state.remaining.toLocaleString()} still to go — send again to continue.` : ""
                }`}
          </AlertDescription>
        </Alert>
      )}

      {readOnly ? (
        <p className="mt-4 text-sm text-muted-foreground">
          This is a read-only preview of the administrator view, so invitations can&apos;t be sent from
          here.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <form action={action}>
            <Button type="submit" disabled={pending || summary.neverInvited === 0}>
              <Mail className="size-4" aria-hidden />
              {pending
                ? "Sending..."
                : `Invite ${summary.neverInvited.toLocaleString()} student${summary.neverInvited === 1 ? "" : "s"}`}
            </Button>
          </form>

          {summary.alreadyInvited > 0 && (
            <form action={action}>
              <input type="hidden" name="reminder" value="1" />
              <Button type="submit" variant="outline" disabled={pending}>
                {pending ? "Sending..." : `Remind all ${summary.awaitingClaim.toLocaleString()}`}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
