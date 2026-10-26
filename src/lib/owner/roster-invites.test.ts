import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMINDER_GAP_DAYS,
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

// October 2026: the class of 2026 graduated in July; 2027 is still here.
const NOW = new Date("2026-10-26T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function entry(email: string, invitedAt: Date | null = null, graduationYear: number | null = null) {
  return { id: `e-${email}`, email, invitedAt, graduationYear };
}

/** An organization row as the send reads it: its own contract, and its district's if it has one. */
function org(overrides: Record<string, unknown> = {}) {
  return {
    officialName: "Aledo High School",
    status: "ACTIVE",
    contractStartDate: daysAgo(60),
    contractEndDate: new Date(NOW.getTime() + 200 * DAY),
    parentDistrict: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.organization.findUnique.mockResolvedValue(org());
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

    expect(await getRosterInviteSummary({ organizationId: "org1" }, NOW)).toEqual({
      awaitingClaim: 2,
      neverInvited: 1,
      alreadyInvited: 1,
      reminderDue: 1,
      nextReminderAt: null,
      nextInviteBatch: 1,
      nextReminderBatch: 1,
      perPressLimit: ROSTER_INVITE_SEND_LIMIT,
      reminderGapDays: REMINDER_GAP_DAYS,
      lastInvitedAt: new Date("2026-10-01"),
    });
  });

  it("counts a student whose membership has ended as claimed, and leaves out a class that has graduated", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([
      entry("ada@school.edu", null, 2027),
      entry("grace@school.edu", null, 2026), // graduated last July
      entry("alan@school.edu"), // signed up, then was removed
    ]);
    // Every membership comes back, whatever its status; the query no longer filters on ACTIVE.
    mocked.studentMembership.findMany.mockResolvedValue([{ verifiedSchoolEmail: "alan@school.edu" }]);

    const summary = await getRosterInviteSummary({ organizationId: "org1" }, NOW);

    expect(summary.awaitingClaim).toBe(1);
    expect(mocked.studentMembership.findMany.mock.calls[0][0].where).not.toHaveProperty("status");
  });

  it("says how many one press sends, and when the next reminder becomes possible", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([
      ...Array.from({ length: ROSTER_INVITE_SEND_LIMIT + 10 }, (_, i) => entry(`new${i}@school.edu`)),
      entry("old@school.edu", daysAgo(10)),
      entry("recent@school.edu", daysAgo(1)),
    ]);

    const summary = await getRosterInviteSummary({ organizationId: "org1" }, NOW);

    expect(summary.nextInviteBatch).toBe(ROSTER_INVITE_SEND_LIMIT);
    expect(summary.reminderDue).toBe(1);
    expect(summary.nextReminderAt).toEqual(new Date(daysAgo(1).getTime() + REMINDER_GAP_DAYS * DAY));
  });

  it("reports the most recent invitation, not the first", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([
      entry("ada@school.edu", new Date("2026-09-01")),
      entry("grace@school.edu", new Date("2026-10-15")),
    ]);

    const summary = await getRosterInviteSummary({ organizationId: "org1" }, NOW);

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

    const result = await sendRosterInvitations({ organizationId: "org1" }, {}, NOW);

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

    await sendRosterInvitations({ organizationId: "org1" }, {}, NOW);

    // Both writes have to be the same transaction: recording without sending
    // means the student is never told, sending without recording means the
    // whole district gets a second copy on the next click.
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
  });

  it("skips a student who has already claimed access", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([entry("ada@school.edu"), entry("alan@school.edu")]);
    mocked.studentMembership.findMany.mockResolvedValue([{ verifiedSchoolEmail: "alan@school.edu" }]);

    const result = await sendRosterInvitations({ organizationId: "org1" }, {}, NOW);

    expect(result.queued).toBe(1);
  });

  it("reminds students emailed before, not ones who have never had an invitation", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([
      entry("grace@school.edu", new Date("2026-10-01")),
      entry("ada@school.edu"),
    ]);

    const result = await sendRosterInvitations({ organizationId: "org1" }, { reminder: true }, NOW);

    expect(result).toEqual({ queued: 1, remaining: 0 });
  });

  it("finishes a reminder round instead of starting again from the top", async () => {
    // 1,200 waiting, all invited a week ago. Each press stamps the batch it
    // sent as emailed now, and the next press sees that.
    const roster = Array.from({ length: 1200 }, (_, i) => entry(`s${String(i).padStart(4, "0")}@school.edu`, daysAgo(7)));
    mocked.schoolRosterEntry.findMany.mockImplementation(async () =>
      [...roster].sort((a, b) => a.invitedAt!.getTime() - b.invitedAt!.getTime()),
    );
    mocked.__tx.schoolRosterEntry.updateMany.mockImplementation(
      async ({ where, data }: { where: { id: { in: string[] } }; data: { invitedAt: Date } }) => {
        for (const e of roster) if (where.id.in.includes(e.id)) e.invitedAt = data.invitedAt;
      },
    );

    const presses = [];
    for (let i = 0; i < 4; i++) presses.push(await sendRosterInvitations({ organizationId: "org1" }, { reminder: true }, NOW));

    expect(presses).toEqual([
      { queued: 500, remaining: 700 },
      { queued: 500, remaining: 200 },
      { queued: 200, remaining: 0 },
      { queued: 0, remaining: 0 },
    ]);
    // Nobody got two reminders.
    const mailed = mocked.__tx.queuedEmail.createMany.mock.calls.flatMap(([{ data }]) => data.map((r: { to: string }) => r.to));
    expect(new Set(mailed).size).toBe(1200);
  });

  it("caps one send and reports what is left, so a district is resumable", async () => {
    const entries = Array.from({ length: ROSTER_INVITE_SEND_LIMIT + 25 }, (_, i) =>
      entry(`student${i}@school.edu`),
    );
    mocked.schoolRosterEntry.findMany.mockResolvedValue(entries);

    const result = await sendRosterInvitations({ organizationId: "org1" }, {}, NOW);

    expect(result).toEqual({ queued: ROSTER_INVITE_SEND_LIMIT, remaining: 25 });
  });

  it("writes nothing when nobody is waiting", async () => {
    const result = await sendRosterInvitations({ organizationId: "org1" }, {}, NOW);

    expect(result).toEqual({ queued: 0, remaining: 0 });
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to invite students to an organization that isn't ACTIVE", async () => {
    mocked.organization.findUnique.mockResolvedValue(org({ status: "SETUP" }));
    mocked.schoolRosterEntry.findMany.mockResolvedValue([entry("ada@school.edu")]);

    await expect(sendRosterInvitations({ organizationId: "org1" }, {}, NOW)).rejects.toThrow("hasn't started yet");
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("refuses once the contract's end date has passed, even with the status still ACTIVE", async () => {
    mocked.organization.findUnique.mockResolvedValue(org({ contractEndDate: daysAgo(1) }));
    mocked.schoolRosterEntry.findMany.mockResolvedValue([entry("ada@school.edu")]);

    await expect(sendRosterInvitations({ organizationId: "org1" }, {}, NOW)).rejects.toThrow("has ended");
  });

  it("judges a campus by its district, which is what decides whether students have Premium", async () => {
    // The campus row still says SETUP from when it was added; the district is live.
    mocked.organization.findUnique.mockResolvedValue(
      org({
        status: "SETUP",
        parentDistrict: { status: "ACTIVE", contractStartDate: daysAgo(60), contractEndDate: new Date(NOW.getTime() + 200 * DAY) },
      }),
    );
    mocked.schoolRosterEntry.findMany.mockResolvedValue([entry("ada@school.edu")]);

    const result = await sendRosterInvitations({ organizationId: "district1", schoolId: "campus1" }, {}, NOW);

    expect(result.queued).toBe(1);
  });

  it("refuses an organization that no longer exists", async () => {
    mocked.organization.findUnique.mockResolvedValue(null);

    await expect(sendRosterInvitations({ organizationId: "org1" }, {}, NOW)).rejects.toThrow(RosterError);
  });

  it("names the school in the invitation and never includes a password", async () => {
    mocked.schoolRosterEntry.findMany.mockResolvedValue([entry("ada@school.edu")]);

    await sendRosterInvitations({ organizationId: "org1" }, {}, NOW);

    const queued = mocked.__tx.queuedEmail.createMany.mock.calls[0][0].data[0];
    expect(queued.subject).toContain("Aledo High School");
    expect(queued.body).toContain("Aledo High School");
    expect(queued.body).toContain("/signup");
    // No credential is ever generated or mailed — the student creates their
    // own account and the roster match is what recognises them.
    expect(queued.body.toLowerCase()).not.toContain("password");
  });
});
