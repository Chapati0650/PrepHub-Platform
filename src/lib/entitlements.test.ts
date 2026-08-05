import { describe, expect, it, vi, beforeEach } from "vitest";
import { getAccessSummary, hasPaidAccess } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
    studentMembership: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

const mockSubscription = prisma.subscription.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockMembership = prisma.studentMembership.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockSubscription.mockReset();
  mockMembership.mockReset();
  mockUser.mockReset();
  // hasPaidAccess looks up the caller's role to special-case Administrators
  // (PRD-011 §7) — default to STUDENT so every pre-existing test (which never
  // mocked this) keeps exercising the subscription/membership logic it's
  // actually testing, not the admin short-circuit.
  mockUser.mockResolvedValue({ role: "STUDENT" });
});

// A currently-in-effect contract, for tests that aren't specifically about
// contract date boundaries.
function activeOrg(
  overrides: Partial<{ status: string; contractStartDate: Date; contractEndDate: Date; officialName: string }> = {},
) {
  return {
    status: "ACTIVE",
    contractStartDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
    contractEndDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    officialName: "Test School",
    ...overrides,
  };
}

describe("hasPaidAccess", () => {
  it("is false with no subscription and no school membership", async () => {
    mockSubscription.mockResolvedValue(null);
    mockMembership.mockResolvedValue(null);

    await expect(hasPaidAccess("user_1")).resolves.toBe(false);
  });

  it("is true for an ACTIVE individual subscription", async () => {
    mockSubscription.mockResolvedValue({ status: "ACTIVE" });
    mockMembership.mockResolvedValue(null);

    await expect(hasPaidAccess("user_1")).resolves.toBe(true);
  });

  it("stays true for a CANCELED subscription until currentPeriodEnd passes", async () => {
    mockMembership.mockResolvedValue(null);

    mockSubscription.mockResolvedValue({
      status: "CANCELED",
      currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24),
    });
    await expect(hasPaidAccess("user_1")).resolves.toBe(true);

    mockSubscription.mockResolvedValue({
      status: "CANCELED",
      currentPeriodEnd: new Date(Date.now() - 1000 * 60 * 60 * 24),
    });
    await expect(hasPaidAccess("user_1")).resolves.toBe(false);
  });

  it("stays true for a PAST_DUE subscription until the grace period ends", async () => {
    mockMembership.mockResolvedValue(null);

    mockSubscription.mockResolvedValue({
      status: "PAST_DUE",
      gracePeriodEndsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    });
    await expect(hasPaidAccess("user_1")).resolves.toBe(true);

    mockSubscription.mockResolvedValue({
      status: "PAST_DUE",
      gracePeriodEndsAt: new Date(Date.now() - 1000),
    });
    await expect(hasPaidAccess("user_1")).resolves.toBe(false);
  });

  it("is true for an active school membership at an active organization", async () => {
    mockSubscription.mockResolvedValue(null);
    const nextYear = new Date().getFullYear() + 1;
    mockMembership.mockResolvedValue({
      status: "ACTIVE",
      expectedGraduationYear: nextYear,
      organization: activeOrg(),
    });

    await expect(hasPaidAccess("user_1")).resolves.toBe(true);
  });

  it("is false once the graduation cutoff (July 1) has passed, even if membership is still ACTIVE", async () => {
    mockSubscription.mockResolvedValue(null);
    const lastYear = new Date().getFullYear() - 1;
    mockMembership.mockResolvedValue({
      status: "ACTIVE",
      expectedGraduationYear: lastYear,
      organization: activeOrg(),
    });

    await expect(hasPaidAccess("user_1")).resolves.toBe(false);
  });

  it("is false when the membership is ACTIVE but the organization is not (suspended/expired)", async () => {
    mockSubscription.mockResolvedValue(null);
    const nextYear = new Date().getFullYear() + 1;
    mockMembership.mockResolvedValue({
      status: "ACTIVE",
      expectedGraduationYear: nextYear,
      organization: activeOrg({ status: "SUSPENDED" }),
    });

    await expect(hasPaidAccess("user_1")).resolves.toBe(false);
  });

  it("is false when the org's status is stuck ACTIVE but its contract end date has already passed", async () => {
    // PRD-017 §16.2 — there's no scheduled job yet flipping status to EXPIRED
    // the moment the contract ends, so this must be checked directly.
    mockSubscription.mockResolvedValue(null);
    const nextYear = new Date().getFullYear() + 1;
    mockMembership.mockResolvedValue({
      status: "ACTIVE",
      expectedGraduationYear: nextYear,
      organization: activeOrg({ contractEndDate: new Date(Date.now() - 1000) }),
    });

    await expect(hasPaidAccess("user_1")).resolves.toBe(false);
  });

  it("is false when the org's contract start date hasn't arrived yet", async () => {
    mockSubscription.mockResolvedValue(null);
    const nextYear = new Date().getFullYear() + 1;
    mockMembership.mockResolvedValue({
      status: "ACTIVE",
      expectedGraduationYear: nextYear,
      organization: activeOrg({ contractStartDate: new Date(Date.now() + 1000 * 60 * 60 * 24) }),
    });

    await expect(hasPaidAccess("user_1")).resolves.toBe(false);
  });

  it("is true when either entitlement alone would grant access (coexistence, PRD-017 §13)", async () => {
    const nextYear = new Date().getFullYear() + 1;
    mockSubscription.mockResolvedValue({ status: "ACTIVE" });
    mockMembership.mockResolvedValue({
      status: "ACTIVE",
      expectedGraduationYear: nextYear,
      organization: activeOrg(),
    });

    await expect(hasPaidAccess("user_1")).resolves.toBe(true);
  });

  it("is true for a School Administrator even with no subscription and no school membership of their own (PRD-011 §7)", async () => {
    mockUser.mockResolvedValue({ role: "SCHOOL_ADMINISTRATOR" });
    mockSubscription.mockResolvedValue(null);
    mockMembership.mockResolvedValue(null);

    await expect(hasPaidAccess("admin_1")).resolves.toBe(true);
  });
});

describe("getAccessSummary", () => {
  it("returns NONE with no subscription and no school membership", async () => {
    mockSubscription.mockResolvedValue(null);
    mockMembership.mockResolvedValue(null);

    await expect(getAccessSummary("user_1")).resolves.toEqual({ type: "NONE" });
  });

  it("returns INDIVIDUAL with the subscription row for an active individual subscription", async () => {
    mockMembership.mockResolvedValue(null);
    const subscription = { status: "ACTIVE", plan: "MONTHLY" };
    mockSubscription.mockResolvedValue(subscription);

    await expect(getAccessSummary("user_1")).resolves.toEqual({ type: "INDIVIDUAL", subscription });
  });

  it("returns SCHOOL with the organization name for an active school entitlement", async () => {
    mockSubscription.mockResolvedValue(null);
    const nextYear = new Date().getFullYear() + 1;
    mockMembership.mockResolvedValue({
      status: "ACTIVE",
      expectedGraduationYear: nextYear,
      organization: activeOrg({ officialName: "Lebanon Trail High School" }),
    });

    await expect(getAccessSummary("user_1")).resolves.toEqual({
      type: "SCHOOL",
      organizationName: "Lebanon Trail High School",
    });
  });

  it("prefers SCHOOL over INDIVIDUAL when both entitlements coexist", async () => {
    const nextYear = new Date().getFullYear() + 1;
    mockSubscription.mockResolvedValue({ status: "ACTIVE" });
    mockMembership.mockResolvedValue({
      status: "ACTIVE",
      expectedGraduationYear: nextYear,
      organization: activeOrg({ officialName: "Plano Academy" }),
    });

    await expect(getAccessSummary("user_1")).resolves.toEqual({ type: "SCHOOL", organizationName: "Plano Academy" });
  });

  it("returns NONE for an inactive/lapsed membership even if a stale subscription row exists but is expired", async () => {
    mockSubscription.mockResolvedValue({
      status: "CANCELED",
      currentPeriodEnd: new Date(Date.now() - 1000),
    });
    mockMembership.mockResolvedValue(null);

    await expect(getAccessSummary("user_1")).resolves.toEqual({ type: "NONE" });
  });
});
