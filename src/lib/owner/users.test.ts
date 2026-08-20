import { describe, expect, it, vi, beforeEach } from "vitest";
import { getUserDirectory } from "@/lib/owner/users";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany: vi.fn() } },
}));

const mockFindMany = prisma.user.findMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFindMany.mockReset();
});

function activeOrg(overrides: Partial<{ status: string; contractStartDate: Date; contractEndDate: Date }> = {}) {
  return {
    status: "ACTIVE",
    contractStartDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
    contractEndDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    ...overrides,
  };
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    firstName: "Test",
    email: "test@example.com",
    role: "STUDENT",
    createdAt: new Date("2026-01-01"),
    subscription: null,
    studentMembership: null,
    ...overrides,
  };
}

describe("getUserDirectory", () => {
  it("returns empty entries and zeroed stats when there are no users", async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await getUserDirectory();

    expect(result.entries).toEqual([]);
    expect(result.stats).toEqual({
      totalUsers: 0,
      totalStudents: 0,
      premiumUsers: 0,
      individualPremium: 0,
      schoolPremium: 0,
    });
  });

  it("marks a student with no subscription and no membership as NONE (Free)", async () => {
    mockFindMany.mockResolvedValue([user()]);

    const result = await getUserDirectory();

    expect(result.entries[0].accessType).toBe("NONE");
    expect(result.stats.premiumUsers).toBe(0);
  });

  it("marks a student with an ACTIVE individual subscription as INDIVIDUAL", async () => {
    mockFindMany.mockResolvedValue([user({ subscription: { status: "ACTIVE" } })]);

    const result = await getUserDirectory();

    expect(result.entries[0].accessType).toBe("INDIVIDUAL");
    expect(result.stats.individualPremium).toBe(1);
    expect(result.stats.premiumUsers).toBe(1);
  });

  it("marks a student with an active school membership as SCHOOL", async () => {
    mockFindMany.mockResolvedValue([
      user({
        studentMembership: {
          status: "ACTIVE",
          expectedGraduationYear: new Date().getFullYear() + 5,
          organization: activeOrg(),
        },
      }),
    ]);

    const result = await getUserDirectory();

    expect(result.entries[0].accessType).toBe("SCHOOL");
    expect(result.stats.schoolPremium).toBe(1);
    expect(result.stats.premiumUsers).toBe(1);
  });

  it("marks a School Administrator as SCHOOL_ADMIN regardless of subscription/membership, and never counts them as premium", async () => {
    mockFindMany.mockResolvedValue([user({ role: "SCHOOL_ADMINISTRATOR" })]);

    const result = await getUserDirectory();

    expect(result.entries[0].accessType).toBe("SCHOOL_ADMIN");
    expect(result.stats.premiumUsers).toBe(0);
  });

  it("does not count OWNER or an inactive subscription/membership toward totalStudents or premiumUsers", async () => {
    mockFindMany.mockResolvedValue([
      user({ role: "OWNER", email: "owner@example.com" }),
      user({ id: "user_2", email: "expired@example.com", subscription: { status: "EXPIRED" } }),
    ]);

    const result = await getUserDirectory();

    expect(result.stats.totalUsers).toBe(2);
    expect(result.stats.totalStudents).toBe(1);
    expect(result.stats.premiumUsers).toBe(0);
  });

  it("aggregates a mixed set of users correctly", async () => {
    mockFindMany.mockResolvedValue([
      user({ id: "owner", role: "OWNER", email: "owner@example.com" }),
      user({ id: "admin", role: "SCHOOL_ADMINISTRATOR", email: "admin@example.com" }),
      user({ id: "paid_individual", email: "paid@example.com", subscription: { status: "ACTIVE" } }),
      user({
        id: "paid_school",
        email: "schoolkid@example.com",
        studentMembership: {
          status: "ACTIVE",
          expectedGraduationYear: new Date().getFullYear() + 5,
          organization: activeOrg(),
        },
      }),
      user({ id: "free", email: "free@example.com" }),
    ]);

    const result = await getUserDirectory();

    expect(result.stats).toEqual({
      totalUsers: 5,
      totalStudents: 3,
      premiumUsers: 2,
      individualPremium: 1,
      schoolPremium: 1,
    });
  });
});
