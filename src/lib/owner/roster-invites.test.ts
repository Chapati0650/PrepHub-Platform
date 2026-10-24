import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROSTER_INVITE_SEND_LIMIT,
  getRosterInviteSummary,
  sendRosterInvitations,
} from "@/lib/owner/roster-invites";
import { RosterError } from "@/lib/owner/roster";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/email-queue", () => ({
  queueRows: (kind: string, recipients: string[], message: { subject: string; text: string }) =>
    recipients.map((to) => ({ kind, to, subject: message.subject, body: message.text })),
  drainForRequest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    queuedEmail: { createMany: vi.fn() },
    schoolRosterEntry: { updateMany: vi.fn() },
  };
  return {
    prisma: {
      organization: { findUnique: vi.fn() },
      schoolRosterEntry: { findMany: vi.fn() },
      studentMembership: { findMany: vi.fn() },
      $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

const mocked = prisma as unknown as {
  organization: Record<string, ReturnType<typeof vi.fn>>;
  schoolRosterEntry: Record<string, ReturnType<typeof vi.fn>>;
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  $transaction: ReturnType<typeof vi.fn>;
  __tx: {
    queuedEmail: Record<string, ReturnType<typeof vi.fn>>;
    schoolRosterEntry: Record<string, ReturnType<typeof vi.fn>>;
  };
};

function entry(email: string, invitedAt: Date | null = null) {
  return { id: `e-${email}`, email, invitedAt };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.organization.findUnique.mockResolvedValue({ officialName: "Aledo High School", status: "ACTIVE" });
  mocked.schoolRosterEntry.findMany.mockResolvedValue([]);
  mocked.studentMembership.findMany.mockResolvedValue([]);
  mocked.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(mocked.__tx));
});

describe("getRosterInviteSummary", () => {
  it("counts only roster entries nobody has claimed yet", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([
      entry("ada@school.edu"),
      entry("grace@school.edu", new Date("2026-10-01")),
      entry("alan@school.edu"),
    ]);
    // Alan already signed up, so he isn't waiting on anything.
    mocked.studentMembership.findMany.mockResolvedValue([{ verifiedSchoolEmail: "alan@school.edu" }]);

    expect(await getRosterInviteSummary({ organizationId: "org1" })).toEqual({
      awaitingClaim: 2,
      neverInvited: 1,
      alreadyInvited: 1,
      lastInvitedAt: new Date("2026-10-01"),
    });
  });

  it("reports the most recent invitation, not the first", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([
      entry("ada@school.edu", new Date("2026-09-01")),
      entry("grace@school.edu", new Date("2026-10-15")),
    ]);

    const summary = await getRosterInviteSummary({ organizationId: "org1" });

    expect(summary.lastInvitedAt).toEqual(new Date("2026-10-15"));
  });
});

describe("sendRosterInvitations", () => {
  it("queues one invitation per never-invited student and marks them invited together", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([
      entry("ada@school.edu"),
      entry("grace@school.edu"),
      entry("alan@school.edu", new Date("2026-10-01")),
    ]);

    const result = await sendRosterInvitations({ organizationId: "org1" });

    expect(result).toEqual({ queued: 2, remaining: 0 });
    // Alan has already had one; a first send must not mail him again.
    expect(mocked.__tx.queuedEmail.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ to: "ada@school.edu", kind: "roster_invite" }),
        expect.objectContaining({ to: "grace@school.edu" }),
      ],
    });
    expect(mocked.__tx.schoolRosterEntry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["e-ada@school.edu", "e-grace@school.edu"] } },
      data: { invitedAt: expect.any(Date), inviteCount: { increment: 1 } },
    });
  });

  it("queues the mail and marks the entries in one transaction", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([entry("ada@school.edu")]);

    await sendRosterInvitations({ organizationId: "org1" });

    // Both writes have to be the same transaction: recording without sending
    // means the student is never told, sending without recording means the
    // whole district gets a second copy on the next click.
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
  });

  it("skips a student who has already claimed access", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([entry("ada@school.edu"), entry("alan@school.edu")]);
    mocked.studentMembership.findMany.mockResolvedValue([{ verifiedSchoolEmail: "alan@school.edu" }]);

    const result = await sendRosterInvitations({ organizationId: "org1" });

    expect(result.queued).toBe(1);
  });

  it("writes to everyone still unclaimed when asked for a reminder", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([
      entry("ada@school.edu"),
      entry("grace@school.edu", new Date("2026-10-01")),
    ]);

    const result = await sendRosterInvitations({ organizationId: "org1" }, { reminder: true });

    expect(result.queued).toBe(2);
  });

  it("caps one send and reports what is left, so a district is resumable", async () => {
    const entries = Array.from({ length: ROSTER_INVITE_SEND_LIMIT + 25 }, (_, i) =>
      entry(`student${i}@school.edu`),
    );
    mocked.schoolRosterEntry.findMany.mockResolvedValue(entries);

    const result = await sendRosterInvitations({ organizationId: "org1" });

    expect(result).toEqual({ queued: ROSTER_INVITE_SEND_LIMIT, remaining: 25 });
  });

  it("writes nothing when nobody is waiting", async () => {
    const result = await sendRosterInvitations({ organizationId: "org1" });

    expect(result).toEqual({ queued: 0, remaining: 0 });
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to invite students to an organization that isn't ACTIVE", async () => {
    mocked.organization.findUnique.mockResolvedValue({ officialName: "Aledo High School", status: "SETUP" });
    mocked.schoolRosterEntry.findMany.mockResolvedValue([entry("ada@school.edu")]);

    await expect(sendRosterInvitations({ organizationId: "org1" })).rejects.toThrow(RosterError);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an organization that no longer exists", async () => {
    mocked.organization.findUnique.mockResolvedValue(null);

    await expect(sendRosterInvitations({ organizationId: "org1" })).rejects.toThrow(RosterError);
  });

  it("names the school in the invitation and never includes a password", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([entry("ada@school.edu")]);

    await sendRosterInvitations({ organizationId: "org1" });

    const queued = mocked.__tx.queuedEmail.createMany.mock.calls[0][0].data[0];
    expect(queued.subject).toContain("Aledo High School");
    expect(queued.body).toContain("Aledo High School");
    expect(queued.body).toContain("/signup");
    // No credential is ever generated or mailed — the student creates their
    // own account and the roster match is what recognises them.
    expect(queued.body.toLowerCase()).not.toContain("password");
  });
});
