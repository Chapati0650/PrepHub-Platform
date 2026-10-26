"use client";

import { useState } from "react";
import { sendCampusInvitesAction, type InviteState } from "./actions";
import type { RosterInviteSummary } from "@/lib/owner/roster-invites";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmButton } from "@/components/confirm-button";
import { GOAL_TIME_ZONE, formatLongLocalDate } from "@/lib/community/local-day";

function students(n: number): string {
  return `${n.toLocaleString()} student${n === 1 ? "" : "s"}`;
}

/**
 * Chasing the students on the campus roster who haven't signed up yet.
 *
 * This is the one part of a launch week the product can automate: the rest
 * (the homeroom session, the follow-ups in person) is staffing. Two buttons
 * rather than one with a checkbox, because a first invitation and a reminder
 * to people who ignored one are different decisions, and the count on each
 * is what makes clear which you are about to do.
 *
 * Each button names what one press sends — a press is capped — and asks
 * before sending, saying how many, because an email can't be unsent. The
 * reminder button said "all 1,200" while sending 500.
 *
 * Hidden entirely when the campus has no roster — a school on email-domain
 * enrollment has nobody to invite, and an empty panel with two dead buttons
 * would just raise a question with no answer.
 */
export function CampusInvitePanel({ summary, readOnly }: { summary: RosterInviteSummary; readOnly: boolean }) {
  const [result, setResult] = useState<(InviteState & { reminder: boolean }) | null>(null);

  if (summary.awaitingClaim === 0 && summary.alreadyInvited === 0) return null;

  const lastSent = summary.lastInvitedAt
    ? new Date(summary.lastInvitedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: GOAL_TIME_ZONE })
    : null;

  async function send(reminder: boolean) {
    const fd = new FormData();
    if (reminder) fd.set("reminder", "1");
    const state = await sendCampusInvitesAction({}, fd);
    // An error stays in the confirmation dialog; only a send is reported here.
    if (!state.error) setResult({ ...state, reminder });
    return state;
  }

  const inviteLabel =
    summary.nextInviteBatch < summary.neverInvited
      ? `Invite the next ${summary.nextInviteBatch.toLocaleString()} of ${students(summary.neverInvited)}`
      : `Invite ${students(summary.neverInvited)}`;
  const reminderLabel =
    summary.nextReminderBatch < summary.reminderDue
      ? `Remind the next ${summary.nextReminderBatch.toLocaleString()} of ${summary.reminderDue.toLocaleString()}`
      : `Send a reminder to ${students(summary.reminderDue)}`;

  return (
    <section aria-labelledby="invite-heading" className="rounded-2xl border border-border p-5 sm:p-6">
      <h2 id="invite-heading" className="text-xl">
        Students on your list who haven&apos;t signed up
      </h2>
      <p className="mt-2 font-heading text-4xl font-semibold tracking-tight tabular-nums">
        {summary.awaitingClaim.toLocaleString()}
      </p>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground">
        PrepHub can email each of them at their school address, asking them to create an account. Nobody&apos;s account
        or password is made for them. One press sends up to {summary.perPressLimit.toLocaleString()} emails; press again for
        the rest.
        {lastSent && ` The last invitations went out on ${lastSent}.`}
      </p>

      {result && (
        <Alert className="mt-4">
          <AlertDescription className="text-base">
            {!result.queued
              ? result.reminder
                ? "Everyone still waiting was emailed in the last few days, so no reminders went out."
                : "Everyone on the list has already been invited."
              : `Sending ${students(result.queued)} ${result.reminder ? "a reminder" : "an invitation"} now.${
                  result.remaining ? ` ${result.remaining.toLocaleString()} still to go: press the button again to send the rest.` : ""
                }`}
          </AlertDescription>
        </Alert>
      )}

      {readOnly ? (
        <p className="mt-4 text-base text-muted-foreground">
          This is a read-only preview of the administrator view, so invitations can&apos;t be sent from here.
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            {summary.nextInviteBatch > 0 && (
              <ConfirmButton
                variant="default"
                size="xl"
                title={`Email ${students(summary.nextInviteBatch)}?`}
                description={`PrepHub emails ${students(summary.nextInviteBatch)} on your list now, at their school address, asking them to sign up. An email can't be unsent.${
                  summary.neverInvited > summary.nextInviteBatch
                    ? ` ${(summary.neverInvited - summary.nextInviteBatch).toLocaleString()} more will still be waiting; press again to send to them.`
                    : ""
                }`}
                confirmLabel={`Send ${summary.nextInviteBatch.toLocaleString()} invitation${summary.nextInviteBatch === 1 ? "" : "s"}`}
                onConfirm={() => send(false)}
              >
                {inviteLabel}
              </ConfirmButton>
            )}

            {summary.nextReminderBatch > 0 && (
              <ConfirmButton
                size="xl"
                title={`Remind ${students(summary.nextReminderBatch)}?`}
                description={`PrepHub emails ${students(summary.nextReminderBatch)} who were invited at least ${summary.reminderGapDays} days ago and still haven't signed up. Each gets one more email now, and won't be reminded again for ${summary.reminderGapDays} days. An email can't be unsent.${
                  summary.reminderDue > summary.nextReminderBatch
                    ? ` ${(summary.reminderDue - summary.nextReminderBatch).toLocaleString()} more will still be due; press again to remind them.`
                    : ""
                }`}
                confirmLabel={`Send ${summary.nextReminderBatch.toLocaleString()} reminder${summary.nextReminderBatch === 1 ? "" : "s"}`}
                onConfirm={() => send(true)}
              >
                {reminderLabel}
              </ConfirmButton>
            )}
          </div>

          {summary.neverInvited === 0 && (
            <p className="text-base text-muted-foreground">
              Everyone on your list has been invited.
              {summary.reminderDue === 0 &&
                summary.nextReminderAt &&
                ` Reminders can go out again from ${formatLongLocalDate(summary.nextReminderAt)}.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
