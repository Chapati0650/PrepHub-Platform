import { prisma } from "@/lib/prisma";
import { drainForRequest, queueRows } from "@/lib/email-queue";
import { RosterError } from "@/lib/owner/roster";

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

export type RosterInviteSummary = {
  /** Active roster entries whose address has no membership yet. */
  awaitingClaim: number;
  /** Of those, how many have never been emailed. */
  neverInvited: number;
  /** Of those, how many have been emailed at least once. */
  alreadyInvited: number;
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

async function unclaimedEntries({ organizationId, schoolId }: InviteScope) {
  const [entries, memberships] = await Promise.all([
    prisma.schoolRosterEntry.findMany({
      where: { organizationId, removedAt: null, ...(schoolId ? { schoolId } : {}) },
      select: { id: true, email: true, invitedAt: true },
      orderBy: [{ invitedAt: "asc" }, { email: "asc" }],
    }),
    // "Claimed" is membership, not merely having an account: a person could
    // have signed up before their district was a partner, and they still need
    // telling that their school access is now live.
    prisma.studentMembership.findMany({
      where: { organizationId, status: "ACTIVE", ...(schoolId ? { schoolId } : {}) },
      select: { verifiedSchoolEmail: true },
    }),
  ]);
  const claimed = new Set(memberships.map((m) => m.verifiedSchoolEmail));
  return entries.filter((e) => !claimed.has(e.email));
}

export async function getRosterInviteSummary(scope: InviteScope): Promise<RosterInviteSummary> {
  const entries = await unclaimedEntries(scope);
  const invited = entries.filter((e) => e.invitedAt !== null);
  const lastInvitedAt = invited.reduce<Date | null>(
    (latest, e) => (!latest || (e.invitedAt && e.invitedAt > latest) ? e.invitedAt : latest),
    null,
  );
  return {
    awaitingClaim: entries.length,
    neverInvited: entries.length - invited.length,
    alreadyInvited: invited.length,
    lastInvitedAt,
  };
}

export type RosterInviteResult = {
  queued: number;
  /** Still awaiting an invitation after this send — click again to continue. */
  remaining: number;
};

/**
 * Queues an invitation to students on the roster who have not claimed access.
 *
 * `reminder: false` (the default) writes to students who have never been
 * emailed, which is what makes repeated clicks safe and resumable.
 * `reminder: true` writes to everyone still unclaimed, invited or not — the
 * explicit "chase the people who ignored the first one" action, which is a
 * different decision and so a different flag rather than a silent re-send.
 */
export async function sendRosterInvitations(
  scope: InviteScope,
  { reminder = false }: { reminder?: boolean } = {},
): Promise<RosterInviteResult> {
  const { organizationId, schoolId } = scope;
  // The campus name when one campus is named, the contract holder otherwise:
  // "Aledo High School has set up free SAT prep for you" is a message a
  // student recognises; the district name may not be.
  const org = await prisma.organization.findUnique({
    where: { id: schoolId ?? organizationId },
    select: { officialName: true, status: true },
  });
  if (!org) throw new RosterError("That organization no longer exists.");
  if (org.status !== "ACTIVE") {
    // Inviting students to a school whose contract has not started, or has
    // been suspended, would send them to a paywall with their school's name
    // on it. Refused rather than handled downstream.
    throw new RosterError(
      "This organization isn't ACTIVE, so its students would have no access to claim. Activate it first.",
    );
  }

  const candidates = await unclaimedEntries(scope);
  const eligible = reminder ? candidates : candidates.filter((e) => e.invitedAt === null);
  const batch = eligible.slice(0, ROSTER_INVITE_SEND_LIMIT);

  if (batch.length === 0) {
    return { queued: 0, remaining: 0 };
  }

  const now = new Date();
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
