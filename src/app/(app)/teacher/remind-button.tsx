"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { actionFailure } from "@/components/staff/action-failure";
import { remindUnfinishedAction } from "./actions";

function plural(n: number, one: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;
}

/** What "Remind them" will do, in the confirmation's required terms: effect, timing, reversibility. */
export function remindDescription(recipients: number, className: string, pastDue: boolean): string {
  return `PrepHub emails the ${plural(recipients, "student")} in ${className} who ${recipients === 1 ? "hasn't" : "haven't"} turned it in, right away, with a link to it${pastDue ? " and a note that it's past due and still accepted" : ""}. Students who have finished, who joined after it was due, or who have left the class aren't emailed. An email can't be unsent, and you can send the next reminder in 24 hours.`;
}

/**
 * "Remind them" for one homework, wherever a teacher sees who hasn't
 * finished it (their home page, the class page). The same action and the
 * same 24-hour limit as the results page's reminder; it confirms first and
 * then says what it sent in place of the button.
 */
export function RemindHomeworkButton({
  assignmentId,
  recipients,
  className,
  pastDue,
  label = "Remind them",
  variant = "default",
}: {
  assignmentId: string;
  recipients: number;
  className: string;
  pastDue: boolean;
  label?: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [sent, setSent] = useState<string | null>(null);
  if (sent) {
    return (
      <p role="status" className="text-base font-medium text-primary dark:text-marker">
        {sent}
      </p>
    );
  }
  return (
    <ConfirmButton
      size="xl"
      variant={variant}
      className={variant === "outline" ? "bg-background" : undefined}
      title={`Email a reminder to ${plural(recipients, "student")}?`}
      description={remindDescription(recipients, className, pastDue)}
      confirmLabel="Send reminder"
      onConfirm={async () => {
        try {
          const result = await remindUnfinishedAction(assignmentId);
          if (result.error) return result;
          setSent(result.sent ? `Reminder sent to ${plural(result.sent, "student")}.` : "Nobody needed a reminder: everyone has turned it in.");
          router.refresh();
          return result;
        } catch (err) {
          return { error: actionFailure(err, "Couldn't send the reminder just now. Try again in a moment.").message };
        }
      }}
    >
      {label}
    </ConfirmButton>
  );
}
