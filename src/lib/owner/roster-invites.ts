import { prisma } from "@/lib/prisma";
import { drainForRequest, queueRows } from "@/lib/email-queue";
import { RosterError } from "@/lib/owner/roster";
import { graduationCutoffYear } from "@/lib/owner/graduation";
import { schoolAccessState, type SchoolAccessState } from "@/lib/admin/access-info";

/**
 * Inviting a district's roster to claim their access.
 *
 * The problem this solves: roster upload and email-domain enrollment were
 * built, so a student who signs up is matched to their campus automatically —
 * but nothing ever told the student to sign up. A district handing over two
 * thousand eligible addresses and hearing nothing back is the most expensive
 * failure mode this product has, and it is entirely an outreach problem.
 *
 * **No account is created and no password is ever generated.** The invitation
 * is a message asking the student to create their own account with their
 * school email; the roster match then does the rest, with no verification
 * round-trip. That is a deliberate choice over mailing generated credentials,
 * which would put PrepHub in custody of passwords for minors, send a live
 * password through a mailbox a parent or sibling may read, and leave every
 * unclaimed account sitting there with a known password forever. The claim is
 * also the only thing the student has to do, so nothing is lost by it.
 */

/**
 * How many students one send covers.
 *
 * Mail is queued, not sent inline, so this is not a provider limit — it is a
 * deliberate ceiling on how much a single click commits to, because a send to
 * a whole district is not something to do by accident. `invitedAt` makes the
 * next click resume exactly where this one stopped.
 */
export const ROSTER_INVITE_SEND_LIMIT = 500;

/**
 * How long after a student's last email before a reminder can go to them.
 *
 * This is what makes a reminder *round* finish. A round can't be remembered
 * without a column for it, so it is defined by the gap instead: a reminder
 * goes only to students last emailed more than three days ago, and stamps
 * them as emailed now. Pressing the button again works through the rest and
 * then stops, because everyone left was just reminded. Before, every press
 * took the 500 longest-waiting, so with 1,200 unclaimed "700 still to go"
 * never went down and the third press began mailing people a second time.
 */
export const REMINDER_GAP_DAYS = 3;
const REMINDER_GAP_MS = REMINDER_GAP_DAYS * 24 * 60 * 60 * 1000;

export type RosterInviteSummary = {
  /** Current roster entries nobody has signed up with, excluding classes that have graduated. */
  awaitingClaim: number;
  /** Of those, how many have never been emailed. */
  neverInvited: number;
  /** Of those, how many have been emailed at least once. */
  alreadyInvited: number;
  /** Of those, how many a reminder would go to now (last emailed over REMINDER_GAP_DAYS ago). */
  reminderDue: number;
  /** When the next of the rest becomes due for a reminder; null when none are waiting on the gap. */
  nextReminderAt: Date | null;
  /** How many one press of each button sends: the count, capped at ROSTER_INVITE_SEND_LIMIT. */
  nextInviteBatch: number;
  nextReminderBatch: number;
  /** The two rules above, carried along so a client panel can state them without importing this module. */
  perPressLimit: number;
  reminderGapDays: number;
  /** The most recent invitation send for this organization, if any. */
  lastInvitedAt: Date | null;
};

/**
 * `schoolId` narrows a district roster to one campus.
 *
 * Present because a School Administrator can invite too (PRD-011 is silent on
 * it; an administrator asked, and chasing your own unregistered students is
 * the one part of a launch the product can automate). Their account is scoped
 * to exactly one campus, so their send must be as well — passed through to
 * every query here rather than filtered afterwards.
 */
export type InviteScope = { organizationId: string; schoolId?: string };

async function unclaimedEntries({ organizationId, schoolId }: InviteScope, now: Date) {
  const [entries, memberships] = await Promise.all([
    prisma.schoolRosterEntry.findMany({
      where: { organizationId, removedAt: null, ...(schoolId ? { schoolId } : {}) },
      select: { id: true, email: true, invitedAt: true, graduationYear: true },
      orderBy: [{ invitedAt: "asc" }, { email: "asc" }],
    }),
    // "Claimed" is membership, not merely having an account: a person could
    // have signed up before their district was a partner, and they still need
    // telling that their school access is now live. A membership of any
    // status counts — a student who was removed or has graduated has had
    // their access and its ending, and an email saying the school "has given
    // you access" would be untrue.
    prisma.studentMembership.findMany({
      where: { organizationId, ...(schoolId ? { schoolId } : {}) },
      select: { verifiedSchoolEmail: true },
    }),
  ]);
  const claimed = new Set(memberships.map((m) => m.verifiedSchoolEmail));
  // A class whose July 1 has passed has no access left to claim, roster or
  // not; a district's list often still carries last year's seniors.
  const graduatedThrough = graduationCutoffYear(now);
  return entries.filter(
    (e) => !claimed.has(e.email) && !(e.graduationYear !== null && e.graduationYear <= graduatedThrough),
  );
}

type UnclaimedEntry = Awaited<ReturnType<typeof unclaimedEntries>>[number];

/** Previously emailed and past the gap, longest-waiting first (the query's order). */
function dueForReminder(entries: UnclaimedEntry[], now: Date): UnclaimedEntry[] {
  return entries.filter((e) => e.invitedAt !== null && e.invitedAt.getTime() <= now.getTime() - REMINDER_GAP_MS);
}

export async function getRosterInviteSummary(scope: InviteScope, now: Date = new Date()): Promise<RosterInviteSummary> {
  const entries = await unclaimedEntries(scope, now);
  const invited = entries.filter((e) => e.invitedAt !== null);
  const lastInvitedAt = invited.reduce<Date | null>(
    (latest, e) => (!latest || (e.invitedAt && e.invitedAt > latest) ? e.invitedAt : latest),
    null,
  );
  const due = dueForReminder(entries, now);
  const dueIds = new Set(due.map((e) => e.id));
  const waiting = invited.filter((e) => !dueIds.has(e.id));
  const earliestWaiting = waiting.reduce<Date | null>(
    (earliest, e) => (!earliest || (e.invitedAt && e.invitedAt < earliest) ? e.invitedAt : earliest),
    null,
  );
  const neverInvited = entries.length - invited.length;
  return {
    awaitingClaim: entries.length,
    neverInvited,
    alreadyInvited: invited.length,
    reminderDue: due.length,
    nextReminderAt: earliestWaiting ? new Date(earliestWaiting.getTime() + REMINDER_GAP_MS) : null,
    nextInviteBatch: Math.min(neverInvited, ROSTER_INVITE_SEND_LIMIT),
    nextReminderBatch: Math.min(due.length, ROSTER_INVITE_SEND_LIMIT),
    perPressLimit: ROSTER_INVITE_SEND_LIMIT,
    reminderGapDays: REMINDER_GAP_DAYS,
    lastInvitedAt,
  };
}

export type RosterInviteResult = {
  queued: number;
  /** Still awaiting an invitation after this send — click again to continue. */
  remaining: number;
};

/**
 * Why invitations can't go out, in plain words: a school administrator sees
 * this on their own Students page, where "isn't ACTIVE, activate it first"
 * named a status they never see and a button they don't have.
 */
const ACCESS_REFUSALS: Record<Exclude<SchoolAccessState, "ACTIVE">, string> = {
  NOT_STARTED:
    "This school's PrepHub access hasn't started yet, so students would have no Premium to claim. Invitations can go out once it starts.",
  ENDED:
    "This school's PrepHub access period has ended, so students would have no Premium to claim. Invitations can go out again once it's renewed.",
  PAUSED:
    "This school's PrepHub access is paused, so students would have no Premium to claim. Invitations can go out again once it's back on.",
  CLOSED: "This school's PrepHub access has been closed, so there's nothing for students to claim.",
};

/**
 * Queues an invitation to students on the roster who have not claimed access.
 *
 * `reminder: false` (the default) writes to students who have never been
 * emailed, which is what makes repeated clicks safe and resumable.
 * `reminder: true` writes to students emailed before, once their last email
 * is more than REMINDER_GAP_DAYS old — the explicit "chase the people who
 * ignored the first one" action, which is a different decision and so a
 * different flag rather than a silent re-send. Either way `remaining` is what
 * pressing the same button again would still reach, and reaches zero.
 */
export async function sendRosterInvitations(
  scope: InviteScope,
  { reminder = false }: { reminder?: boolean } = {},
  now: Date = new Date(),
): Promise<RosterInviteResult> {
  const { organizationId, schoolId } = scope;
  // The campus name when one campus is named, the contract holder otherwise:
  // "Aledo High School has set up free SAT prep for you" is a message a
  // student recognises; the district name may not be.
  const contract = { status: true, contractStartDate: true, contractEndDate: true } as const;
  const org = await prisma.organization.findUnique({
    where: { id: schoolId ?? organizationId },
    select: { officialName: true, ...contract, parentDistrict: { select: contract } },
  });
  if (!org) throw new RosterError("That organization no longer exists.");
  // Inviting students to a school whose access isn't on — not started,
  // paused, or past its end date — would send them to a paywall with their
  // school's name on it. Refused rather than handled downstream. Judged on
  // the organization that pays (the district, for a campus under one), the
  // same row and the same rule the entitlement service uses; a campus row's
  // own status is a copy that nothing keeps current.
  const access = schoolAccessState(org.parentDistrict ?? org, now);
  if (access !== "ACTIVE") throw new RosterError(ACCESS_REFUSALS[access]);

  const candidates = await unclaimedEntries(scope, now);
  const eligible = reminder ? dueForReminder(candidates, now) : candidates.filter((e) => e.invitedAt === null);
  const batch = eligible.slice(0, ROSTER_INVITE_SEND_LIMIT);

  if (batch.length === 0) {
    return { queued: 0, remaining: 0 };
  }

  const message = invitationMessage(org.officialName);

  // One transaction: the mail is queued and the entries are marked invited
  // together, so a crash can neither send without recording it (the whole
  // district gets a second copy on the next click) nor record without sending
  // (the student is never told at all).
  await prisma.$transaction(async (tx) => {
    await tx.queuedEmail.createMany({
      data: queueRows("roster_invite", batch.map((e) => e.email), message),
    });
    await tx.schoolRosterEntry.updateMany({
      where: { id: { in: batch.map((e) => e.id) } },
      data: { invitedAt: now, inviteCount: { increment: 1 } },
    });
  });

  await drainForRequest();

  return { queued: batch.length, remaining: eligible.length - batch.length };
}

/**
 * The invitation itself: plain text, in the Owner's voice, same as every other
 * transactional email this product sends.
 *
 * It names the school because an unexpected message about a test is ignored
 * and one from your own district is not, and it says what the student has to
 * do in one sentence, because the whole point is that claiming access is a
 * single step.
 */
function invitationMessage(schoolName: string): { subject: string; text: string } {
  // Same env var and same fallback as the lifecycle emails, so every link
  // PrepHub mails out points at one place.
  const url = `${process.env.NEXTAUTH_URL ?? "https://prephubtp.com"}/signup`;
  return {
    subject: `${schoolName} has set up free SAT prep for you`,
    text: [
      `Hi,`,
      ``,
      `${schoolName} has given you access to PrepHub, an SAT prep platform, at no cost to you.`,
      ``,
      `Create your account here: ${url}`,
      ``,
      `Sign up with this school email address — that is how we know you're one of ${schoolName}'s students, and it is the only step. You'll start with a 15-minute Diagnostic that tells you where you actually stand, and your practice adapts from there.`,
      ``,
      `If you have any questions, just reply to this message.`,
      ``,
      `— Prithvi, PrepHub`,
    ].join("\n"),
  };
}

/**
 * The invite scope for one campus, resolved from the campus alone.
 *
 * A roster belongs to whichever organization supplied it — the district for a
 * district campus, the school itself when it stands alone — while a School
 * Administrator only knows their own `schoolId`. This is the one place that
 * mapping lives, so the admin path cannot accidentally scope a send to the
 * wrong level and mail another campus.
 */
export async function inviteScopeForSchool(schoolId: string): Promise<InviteScope> {
  const school = await prisma.organization.findUnique({
    where: { id: schoolId },
    select: { parentDistrictId: true },
  });
  if (!school) throw new RosterError("That school no longer exists.");
  return { organizationId: school.parentDistrictId ?? schoolId, schoolId };
}
