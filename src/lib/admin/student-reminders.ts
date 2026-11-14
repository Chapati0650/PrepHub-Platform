import { prisma } from "@/lib/prisma";
import { drainForRequest, isPlausibleEmailAddress } from "@/lib/email-queue";
import { dayKey } from "@/lib/daily/challenge";
import { logUnauthorizedAccess } from "@/lib/logger";
import { AdminError } from "./errors";
import { matchingMembershipIds, type StudentDirectoryFilters } from "./student-directory";
import { ADMIN_REMINDER_KIND, recentlyReminded } from "./reminder-log";
import { cleanReminderInput, reminderEmail } from "./reminder-message";

// "Email these students" on the Students page (2026-11-14, at the Owner's
// request): an administrator filters the list ("haven't started yet": 11)
// and sends exactly those students a reminder, without copying addresses into
// their own mail.
//
// The rules, each enforced here rather than by the page:
// - Only students at this administrator's school, and only those whose access
//   is live (ACTIVE): a removed or graduated student is history, not a
//   student to chase.
// - A student reminded in the last `REMINDER_COOLDOWN_DAYS` is skipped, and
//   the composer says how many before anything is sent, so pressing Send
//   twice, or two administrators working the same list, can't pile messages
//   on one student.
// - The audience is recomputed from the filters on the server at send time;
//   the page's count is only a preview. A list of chosen students is checked
//   against the school too.
// - Mail goes through the outbound queue like announcements, claimed in the
//   same transaction (`EmailSend`, unique per student per day).

const SITE = process.env.NEXTAUTH_URL ?? "https://prephubtp.com";

/** More than this in one send means the list wasn't narrowed; announcements are for everyone. */
export const REMINDER_MAX_RECIPIENTS = 3000;

export type ReminderTarget =
  | { kind: "filter"; filters: StudentDirectoryFilters }
  | { kind: "selected"; membershipIds: string[] };

type Recipient = { studentId: string; firstName: string; email: string };

export type ReminderAudience = {
  recipients: Recipient[];
  /** Skipped: emailed a reminder inside the cooldown. */
  recentlyReminded: number;
  /** Skipped: removed or graduated, so not a current student. */
  noAccess: number;
};

/** Who a reminder would reach right now, and who it would skip and why. */
export async function resolveReminderAudience(schoolId: string, target: ReminderTarget, now: Date = new Date()): Promise<ReminderAudience> {
  let ids: string[];
  if (target.kind === "filter") {
    ids = await matchingMembershipIds(schoolId, target.filters, now);
  } else {
    ids = [...new Set(target.membershipIds.filter((id) => typeof id === "string" && id.length > 0))];
  }
  if (ids.length > REMINDER_MAX_RECIPIENTS) {
    throw new AdminError(
      "INVALID_INPUT",
      `That's ${ids.length.toLocaleString()} students. Narrow the list first, or post an announcement to reach everyone.`,
    );
  }
  if (ids.length === 0) return { recipients: [], recentlyReminded: 0, noAccess: 0 };

  const memberships = await prisma.studentMembership.findMany({
    // Scoped by school as well as by id: a chosen id from another school is
    // simply not found.
    where: { id: { in: ids }, schoolId },
    select: { status: true, studentId: true, verifiedSchoolEmail: true, student: { select: { firstName: true, deletedAt: true } } },
  });
  if (target.kind === "selected" && memberships.length < ids.length) {
    logUnauthorizedAccess("Administrator tried to email students outside their school", {
      organizationId: schoolId,
      requested: ids.length,
      found: memberships.length,
    });
  }

  const current = memberships.filter((m) => m.status === "ACTIVE" && !m.student.deletedAt && isPlausibleEmailAddress(m.verifiedSchoolEmail));
  const recent = await recentlyReminded(
    current.map((m) => m.studentId),
    now,
  );
  return {
    recipients: current
      .filter((m) => !recent.has(m.studentId))
      .map((m) => ({ studentId: m.studentId, firstName: m.student.firstName, email: m.verifiedSchoolEmail })),
    recentlyReminded: current.filter((m) => recent.has(m.studentId)).length,
    noAccess: memberships.length - current.length,
  };
}

export type ReminderPreview = { eligible: number; recentlyReminded: number; noAccess: number };

export async function previewReminderAudience(schoolId: string, target: ReminderTarget, now: Date = new Date()): Promise<ReminderPreview> {
  const audience = await resolveReminderAudience(schoolId, target, now);
  return { eligible: audience.recipients.length, recentlyReminded: audience.recentlyReminded, noAccess: audience.noAccess };
}

export type ReminderResult = { sent: number; recentlyReminded: number; noAccess: number };

export async function sendStudentReminders(
  schoolId: string,
  sender: { firstName: string },
  target: ReminderTarget,
  input: { subject: unknown; message: unknown },
  now: Date = new Date(),
): Promise<ReminderResult> {
  const cleaned = cleanReminderInput(input);
  if ("error" in cleaned) throw new AdminError("INVALID_INPUT", cleaned.error);

  const [audience, school] = await Promise.all([
    resolveReminderAudience(schoolId, target, now),
    prisma.organization.findUniqueOrThrow({ where: { id: schoolId }, select: { officialName: true } }),
  ]);
  if (audience.recipients.length === 0) {
    throw new AdminError(
      "INVALID_INPUT",
      audience.recentlyReminded > 0
        ? "Everyone in this list was already sent a reminder in the last few days, so nothing was sent."
        : "Nobody in this list can be emailed: it has no current students.",
    );
  }

  const day = dayKey(now);
  const sent = await prisma.$transaction(async (tx) => {
    // Only the claims this call wins are mailed: a student another send
    // reached today already has the row.
    const claimed = await tx.emailSend.createManyAndReturn({
      data: audience.recipients.map((r) => ({ userId: r.studentId, kind: ADMIN_REMINDER_KIND, day, sentAt: now })),
      skipDuplicates: true,
      select: { userId: true },
    });
    const won = new Set(claimed.map((c) => c.userId));
    const rows = audience.recipients
      .filter((r) => won.has(r.studentId))
      .map((r) => {
        const email = reminderEmail({
          firstName: r.firstName,
          schoolName: school.officialName,
          senderName: sender.firstName,
          subject: cleaned.subject,
          message: cleaned.message,
          site: SITE,
        });
        return { kind: ADMIN_REMINDER_KIND, to: r.email, subject: email.subject, body: email.text };
      });
    if (rows.length > 0) await tx.queuedEmail.createMany({ data: rows });
    return rows.length;
  });

  await drainForRequest();
  return {
    sent,
    recentlyReminded: audience.recentlyReminded + (audience.recipients.length - sent),
    noAccess: audience.noAccess,
  };
}
