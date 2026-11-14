import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { matchingMembershipIds } from "@/lib/admin/student-directory";
import { logUnauthorizedAccess } from "@/lib/logger";
import { drainForRequest } from "@/lib/email-queue";
import {
  REMINDER_MAX_RECIPIENTS,
  previewReminderAudience,
  resolveReminderAudience,
  sendStudentReminders,
} from "@/lib/admin/student-reminders";
import { AdminError } from "@/lib/admin/errors";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    studentMembership: { findMany: vi.fn() },
    emailSend: { findMany: vi.fn() },
    organization: { findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/admin/student-directory", () => ({ matchingMembershipIds: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logUnauthorizedAccess: vi.fn() }));
vi.mock("@/lib/email-queue", () => ({
  drainForRequest: vi.fn(),
  isPlausibleEmailAddress: (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e),
}));

const mocked = prisma as unknown as {
  studentMembership: { findMany: ReturnType<typeof vi.fn> };
  emailSend: { findMany: ReturnType<typeof vi.fn> };
  organization: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const NOW = new Date("2026-11-14T15:00:00Z");

function membership(studentId: string, overrides: Partial<{ status: string; email: string; deletedAt: Date | null }> = {}) {
  return {
    status: overrides.status ?? "ACTIVE",
    studentId,
    verifiedSchoolEmail: overrides.email ?? `${studentId}@school.org`,
    student: { firstName: studentId.toUpperCase(), deletedAt: overrides.deletedAt ?? null },
  };
}

let tx: { emailSend: { createManyAndReturn: ReturnType<typeof vi.fn> }; queuedEmail: { createMany: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.clearAllMocks();
  mocked.emailSend.findMany.mockResolvedValue([]);
  mocked.organization.findUniqueOrThrow.mockResolvedValue({ officialName: "Northside High School" });
  tx = {
    emailSend: { createManyAndReturn: vi.fn(async ({ data }: { data: { userId: string }[] }) => data.map((d) => ({ userId: d.userId }))) },
    queuedEmail: { createMany: vi.fn() },
  };
  mocked.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
});

describe("resolveReminderAudience", () => {
  it("reaches current students only, skipping the removed, the deleted and the recently reminded", async () => {
    vi.mocked(matchingMembershipIds).mockResolvedValue(["m1", "m2", "m3", "m4", "m5"]);
    mocked.studentMembership.findMany.mockResolvedValue([
      membership("a"),
      membership("b"),
      membership("c", { status: "GRADUATED" }),
      membership("d", { deletedAt: NOW }),
      membership("e", { email: "not-an-address" }),
    ]);
    mocked.emailSend.findMany.mockResolvedValue([{ userId: "b" }]);

    const audience = await resolveReminderAudience("school1", { kind: "filter", filters: { activity: "GONE_QUIET" } }, NOW);

    expect(audience.recipients.map((r) => r.studentId)).toEqual(["a"]);
    expect(audience.recentlyReminded).toBe(1);
    expect(audience.noAccess).toBe(3);
    // The cooldown is asked about the current students only, within 3 days.
    const where = mocked.emailSend.findMany.mock.calls[0][0].where;
    expect(where.userId.in).toEqual(["a", "b"]);
    expect(where.sentAt.gte).toEqual(new Date("2026-11-11T15:00:00Z"));
  });

  it("scopes chosen students to the school and logs ids from elsewhere", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([membership("a")]);

    const audience = await resolveReminderAudience("school1", { kind: "selected", membershipIds: ["m1", "m1", "elsewhere"] }, NOW);

    expect(mocked.studentMembership.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["m1", "elsewhere"] }, schoolId: "school1" });
    expect(audience.recipients).toHaveLength(1);
    expect(logUnauthorizedAccess).toHaveBeenCalledOnce();
    expect(matchingMembershipIds).not.toHaveBeenCalled();
  });

  it("refuses a list too long to be a nudge", async () => {
    vi.mocked(matchingMembershipIds).mockResolvedValue(Array.from({ length: REMINDER_MAX_RECIPIENTS + 1 }, (_, i) => `m${i}`));
    await expect(resolveReminderAudience("school1", { kind: "filter", filters: {} }, NOW)).rejects.toBeInstanceOf(AdminError);
  });

  it("previews counts without names", async () => {
    vi.mocked(matchingMembershipIds).mockResolvedValue(["m1"]);
    mocked.studentMembership.findMany.mockResolvedValue([membership("a")]);
    expect(await previewReminderAudience("school1", { kind: "filter", filters: {} }, NOW)).toEqual({
      eligible: 1,
      recentlyReminded: 0,
      noAccess: 0,
    });
  });
});

describe("sendStudentReminders", () => {
  const target = { kind: "filter" as const, filters: { activity: "NOT_STARTED" as const } };

  it("claims each student, queues one personal email per claim, then drains", async () => {
    vi.mocked(matchingMembershipIds).mockResolvedValue(["m1", "m2"]);
    mocked.studentMembership.findMany.mockResolvedValue([membership("a"), membership("b")]);

    const result = await sendStudentReminders("school1", { firstName: "Jordan" }, target, { subject: "Start", message: "Please start." }, NOW);

    expect(result).toEqual({ sent: 2, recentlyReminded: 0, noAccess: 0 });
    const claims = tx.emailSend.createManyAndReturn.mock.calls[0][0];
    expect(claims.skipDuplicates).toBe(true);
    expect(claims.data).toEqual([
      { userId: "a", kind: "admin_reminder", day: "2026-11-14", sentAt: NOW },
      { userId: "b", kind: "admin_reminder", day: "2026-11-14", sentAt: NOW },
    ]);
    const rows = tx.queuedEmail.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { to: string }) => r.to)).toEqual(["a@school.org", "b@school.org"]);
    expect(rows[0].body.startsWith("Hi A,\n\nPlease start.")).toBe(true);
    expect(rows[0].body).toContain("Jordan, Northside High School");
    expect(drainForRequest).toHaveBeenCalledOnce();
  });

  it("mails only the claims it won, so a simultaneous send can't double up", async () => {
    vi.mocked(matchingMembershipIds).mockResolvedValue(["m1", "m2"]);
    mocked.studentMembership.findMany.mockResolvedValue([membership("a"), membership("b")]);
    tx.emailSend.createManyAndReturn.mockResolvedValue([{ userId: "b" }]);

    const result = await sendStudentReminders("school1", { firstName: "Jordan" }, target, { subject: "S", message: "M" }, NOW);

    expect(result.sent).toBe(1);
    expect(result.recentlyReminded).toBe(1);
    expect(tx.queuedEmail.createMany.mock.calls[0][0].data.map((r: { to: string }) => r.to)).toEqual(["b@school.org"]);
  });

  it("sends nothing, and says why, when everyone was reminded lately", async () => {
    vi.mocked(matchingMembershipIds).mockResolvedValue(["m1"]);
    mocked.studentMembership.findMany.mockResolvedValue([membership("a")]);
    mocked.emailSend.findMany.mockResolvedValue([{ userId: "a" }]);

    await expect(sendStudentReminders("school1", { firstName: "J" }, target, { subject: "S", message: "M" }, NOW)).rejects.toThrow(
      /already sent a reminder/,
    );
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("checks the wording before looking anyone up", async () => {
    await expect(sendStudentReminders("school1", { firstName: "J" }, target, { subject: "", message: "M" }, NOW)).rejects.toThrow(/subject/);
    expect(matchingMembershipIds).not.toHaveBeenCalled();
  });
});
