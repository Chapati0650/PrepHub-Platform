import type { DirectoryActivityFilter } from "./student-directory";

// What an administrator's "Email these students" sends (2026-11-14). Pure and
// client-safe: the composer shows exactly this text as its preview, and the
// server builds every queued email from the same functions.
//
// The default wording is chosen by the list it's sent from, because the
// filter already says why the administrator is writing: a student who never
// started needs to hear what the first step is, one who stopped needs to hear
// their work is saved. The administrator can rewrite any of it.

/** The `EmailSend` kind that records each reminder (see reminder-log.ts). */
export const ADMIN_REMINDER_KIND = "admin_reminder";

/** A student emailed a reminder this recently is skipped by the next one. */
export const REMINDER_COOLDOWN_DAYS = 3;

/** How far back the list shows "Reminded …" beside a student. */
export const REMINDER_SHOWN_DAYS = 30;

export const REMINDER_SUBJECT_MAX = 150;
export const REMINDER_MESSAGE_MAX = 2000;

export type ReminderTemplate = DirectoryActivityFilter | "GENERAL";

export function reminderTemplateFor(activity: DirectoryActivityFilter | undefined): ReminderTemplate {
  return activity ?? "GENERAL";
}

export function defaultReminder(template: ReminderTemplate, schoolName: string): { subject: string; message: string } {
  switch (template) {
    case "NOT_STARTED":
      return {
        subject: `Your free SAT prep from ${schoolName} is waiting`,
        message: [
          `You signed up for PrepHub through ${schoolName}, but you haven't started yet.`,
          `The first step is the Diagnostic. It takes about 15 minutes and shows where you stand in every part of the SAT. After that, your practice is built around what you need most.`,
          `PrepHub is free for you through the school. Could you give it 15 minutes this week?`,
        ].join("\n\n"),
      };
    case "GONE_QUIET":
      return {
        subject: "Pick up where you left off on PrepHub",
        message: [
          `You made a good start on PrepHub, and it's been a couple of weeks since you last practiced.`,
          `Everything you've done is saved, so you can pick up right where you stopped. Even 20 minutes a week keeps your progress moving.`,
        ].join("\n\n"),
      };
    case "ACTIVE_THIS_WEEK":
      return {
        subject: "Thanks for practicing on PrepHub this week",
        message: [
          `You've been practicing on PrepHub this week. Thank you for putting in the time.`,
          `Keep it going: a little practice most days is what moves a score.`,
        ].join("\n\n"),
      };
    case "GENERAL":
      return {
        subject: `A note from ${schoolName} about PrepHub`,
        message: [
          `A reminder that you have PrepHub, an SAT prep platform, free through ${schoolName}.`,
          `Sign in whenever you have 15 minutes. Every question you answer makes your practice fit you better.`,
        ].join("\n\n"),
      };
  }
}

/**
 * The subject and message as they will be sent, or why they can't be. One
 * line of subject (a pasted line break would otherwise end up in a mail
 * header), trimmed, and both within their limits.
 */
export function cleanReminderInput(input: { subject: unknown; message: unknown }):
  | { subject: string; message: string }
  | { error: string } {
  const subject = typeof input.subject === "string" ? input.subject.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim() : "";
  const message = typeof input.message === "string" ? input.message.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : "";
  if (!subject) return { error: "Add a subject line." };
  if (subject.length > REMINDER_SUBJECT_MAX) return { error: `Keep the subject under ${REMINDER_SUBJECT_MAX} characters.` };
  if (!message) return { error: "Write a message for the students." };
  if (message.length > REMINDER_MESSAGE_MAX) return { error: `Keep the message under ${REMINDER_MESSAGE_MAX.toLocaleString()} characters.` };
  return { subject, message };
}

/**
 * One student's email: their own first name, the administrator's message, a
 * link in, and who it's from. Plain text like every email PrepHub sends.
 */
export function reminderEmail({
  firstName,
  schoolName,
  senderName,
  subject,
  message,
  site,
}: {
  firstName: string;
  schoolName: string;
  senderName: string;
  subject: string;
  message: string;
  site: string;
}): { subject: string; text: string } {
  return {
    subject,
    text: [
      `Hi ${firstName.trim() || "there"},`,
      message,
      `Sign in to PrepHub: ${site}/home`,
      `${senderName}, ${schoolName}`,
      `Sent through PrepHub on behalf of ${schoolName}.`,
    ].join("\n\n"),
  };
}
