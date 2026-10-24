import { beforeEach, describe, expect, it, vi } from "vitest";
import { graduationCutoffYear, runGraduationSweep } from "@/lib/owner/graduation";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const tx = {
    studentMembership: { updateMany: vi.fn() },
    membershipHistoryEvent: { createMany: vi.fn() },
  };
  return {
    prisma: {
      studentMembership: { findMany: vi.fn() },
      $transaction: vi.fn(),
      __tx: tx,
    },
  };
});

const mocked = prisma as unknown as {
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  $transaction: ReturnType<typeof vi.fn>;
  __tx: {
    studentMembership: Record<string, ReturnType<typeof vi.fn>>;
    membershipHistoryEvent: Record<string, ReturnType<typeof vi.fn>>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.studentMembership.findMany.mockResolvedValue([]);
  mocked.__tx.studentMembership.updateMany.mockResolvedValue({ count: 0 });
  mocked.__tx.membershipHistoryEvent.createMany.mockResolvedValue({ count: 0 });
  mocked.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(mocked.__tx));
});

// The whole correctness of the rollover is in this one comparison, and an
// off-by-one either cuts a senior off mid-year or lets a graduate keep
// district-funded access for another year.
describe("graduationCutoffYear", () => {
  it("has not yet graduated the current year's class in June", () => {
    expect(graduationCutoffYear(new Date("2027-06-30T23:59:59Z"))).toBe(2026);
  });

  it("graduates the current year's class from July 1", () => {
    expect(graduationCutoffYear(new Date("2027-07-01T00:00:00Z"))).toBe(2027);
  });

  it("stays on the current year through to December", () => {
    expect(graduationCutoffYear(new Date("2027-12-31T23:59:59Z"))).toBe(2027);
  });

  it("rolls back to the previous year in January", () => {
    expect(graduationCutoffYear(new Date("2028-01-01T00:00:00Z"))).toBe(2027);
  });
});

describe("runGraduationSweep", () => {
  it("graduates every ACTIVE membership at or past the cutoff year", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    mocked.__tx.studentMembership.updateMany.mockResolvedValue({ count: 2 });

    const result = await runGraduationSweep(new Date("2027-07-01T00:00:00Z"));

    expect(result).toEqual({ graduated: 2, cutoffYear: 2027 });
    expect(mocked.studentMembership.findMany).toHaveBeenCalledWith({
      where: { status: "ACTIVE", expectedGraduationYear: { lte: 2027 } },
      select: { id: true },
    });
  });

  it("writes a history event for every graduation, in the same transaction", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    mocked.__tx.studentMembership.updateMany.mockResolvedValue({ count: 2 });

    await runGraduationSweep(new Date("2027-07-01T00:00:00Z"));

    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
    expect(mocked.__tx.membershipHistoryEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ membershipId: "m1", eventType: "GRADUATION" }),
        expect.objectContaining({ membershipId: "m2", eventType: "GRADUATION" }),
      ],
    });
  });

  it("re-checks ACTIVE inside the transaction so a hand-graduated student isn't counted twice", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ id: "m1" }]);

    await runGraduationSweep(new Date("2027-07-01T00:00:00Z"));

    expect(mocked.__tx.studentMembership.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1"] }, status: "ACTIVE" },
      data: { status: "GRADUATED", graduatedAt: expect.any(Date) },
    });
  });

  it("reports what it actually changed, not what it intended to", async () => {
    // Someone graduated m1 by hand between the read and the write.
    mocked.studentMembership.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    mocked.__tx.studentMembership.updateMany.mockResolvedValue({ count: 1 });

    const result = await runGraduationSweep(new Date("2027-07-01T00:00:00Z"));

    expect(result.graduated).toBe(1);
  });

  it("does nothing, and opens no transaction, when nobody is due", async () => {
    const result = await runGraduationSweep(new Date("2027-07-01T00:00:00Z"));

    expect(result.graduated).toBe(0);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("chunks a district-sized cohort rather than writing one huge statement", async () => {
    mocked.studentMembership.findMany.mockResolvedValue(
      Array.from({ length: 1200 }, (_, i) => ({ id: `m${i}` })),
    );
    mocked.__tx.studentMembership.updateMany.mockResolvedValue({ count: 500 });

    await runGraduationSweep(new Date("2027-07-01T00:00:00Z"));

    // 500 + 500 + 200
    expect(mocked.$transaction).toHaveBeenCalledTimes(3);
  });
});
