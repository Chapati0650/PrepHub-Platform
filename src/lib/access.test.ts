import { describe, expect, it, vi, beforeEach } from "vitest";
import { canUseStudentExperience, needsAccessSelection } from "@/lib/access";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
    studentMembership: { findUnique: vi.fn() },
  },
}));

const mockSubscription = prisma.subscription.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockMembership = prisma.studentMembership.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockSubscription.mockReset();
  mockMembership.mockReset();
});

describe("needsAccessSelection", () => {
  it("is true when neither a subscription nor a membership row exists", async () => {
    mockSubscription.mockResolvedValue(null);
    mockMembership.mockResolvedValue(null);
    await expect(needsAccessSelection("u1")).resolves.toBe(true);
  });

  it("is false once a subscription row exists, regardless of its status", async () => {
    mockSubscription.mockResolvedValue({ status: "EXPIRED" });
    mockMembership.mockResolvedValue(null);
    await expect(needsAccessSelection("u1")).resolves.toBe(false);
  });

  it("is false once a membership row exists, regardless of its status", async () => {
    mockSubscription.mockResolvedValue(null);
    mockMembership.mockResolvedValue({ status: "REMOVED" });
    await expect(needsAccessSelection("u1")).resolves.toBe(false);
  });
});

describe("canUseStudentExperience", () => {
  it("is true for STUDENT", () => {
    expect(canUseStudentExperience("STUDENT")).toBe(true);
  });

  it("is true for SCHOOL_ADMINISTRATOR (PRD-011 §7)", () => {
    expect(canUseStudentExperience("SCHOOL_ADMINISTRATOR")).toBe(true);
  });

  it("is false for OWNER", () => {
    expect(canUseStudentExperience("OWNER")).toBe(false);
  });

  it("is false when there's no role at all", () => {
    expect(canUseStudentExperience(undefined)).toBe(false);
  });
});
