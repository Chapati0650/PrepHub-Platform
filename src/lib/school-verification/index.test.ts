import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  requestSchoolVerification,
  resolveVerificationToken,
  completeSchoolVerification,
} from "@/lib/school-verification";
import { prisma } from "@/lib/prisma";
import { scheduleSubscriptionNonRenewal } from "@/lib/billing";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    studentMembership: { findUnique: vi.fn(), create: vi.fn() },
    organizationDomain: { findFirst: vi.fn() },
    schoolVerificationToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    user: { findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/billing", () => ({ scheduleSubscriptionNonRenewal: vi.fn() }));

const mocked = prisma as unknown as {
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  organizationDomain: Record<string, ReturnType<typeof vi.fn>>;
  schoolVerificationToken: Record<string, ReturnType<typeof vi.fn>>;
  user: Record<string, ReturnType<typeof vi.fn>>;
};
const mockedScheduleNonRenewal = scheduleSubscriptionNonRenewal as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requestSchoolVerification", () => {
  const activeOrg = { id: "org1", status: "ACTIVE", organizationType: "SCHOOL" };

  function mockNoExisting() {
    mocked.studentMembership.findUnique.mockResolvedValue(null);
  }

  it("throws ALREADY_HAS_MEMBERSHIP when the student already has a membership", async () => {
    mocked.studentMembership.findUnique.mockImplementation(({ where }: { where: object }) =>
      "studentId" in where ? { id: "m1" } : null,
    );

    await expect(
      requestSchoolVerification("student1", "kid@k12.friscoisd.org"),
    ).rejects.toMatchObject({ code: "ALREADY_HAS_MEMBERSHIP" });
  });

  it("throws SCHOOL_EMAIL_ALREADY_LINKED when the email is used by another account", async () => {
    mocked.studentMembership.findUnique.mockImplementation(({ where }: { where: object }) =>
      "verifiedSchoolEmail" in where ? { id: "m2" } : null,
    );

    await expect(
      requestSchoolVerification("student1", "kid@k12.friscoisd.org"),
    ).rejects.toMatchObject({ code: "SCHOOL_EMAIL_ALREADY_LINKED" });
  });

  it("throws DOMAIN_NOT_PARTNER when no approved domain matches", async () => {
    mockNoExisting();
    mocked.organizationDomain.findFirst.mockResolvedValue(null);

    await expect(
      requestSchoolVerification("student1", "kid@nobody.example.com"),
    ).rejects.toMatchObject({ code: "DOMAIN_NOT_PARTNER" });
  });

  it("throws PARTNERSHIP_INACTIVE when the matched org isn't ACTIVE", async () => {
    mockNoExisting();
    mocked.organizationDomain.findFirst.mockResolvedValue({
      organizationId: "org1",
      organization: { ...activeOrg, status: "SUSPENDED" },
    });

    await expect(
      requestSchoolVerification("student1", "kid@k12.friscoisd.org"),
    ).rejects.toMatchObject({ code: "PARTNERSHIP_INACTIVE" });
  });

  it("creates a token and sends an email on success", async () => {
    mockNoExisting();
    mocked.organizationDomain.findFirst.mockResolvedValue({
      organizationId: "org1",
      organization: activeOrg,
    });
    mocked.schoolVerificationToken.create.mockResolvedValue({});

    await requestSchoolVerification("student1", "  Kid@K12.FriscoISD.org  ");

    const createCall = mocked.schoolVerificationToken.create.mock.calls[0][0];
    expect(createCall.data.studentId).toBe("student1");
    expect(createCall.data.requestedEmail).toBe("kid@k12.friscoisd.org"); // trimmed + lowercased
    expect(createCall.data.matchedOrganizationId).toBe("org1");
  });
});

describe("resolveVerificationToken", () => {
  it("throws INVALID_TOKEN for an unknown token", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue(null);
    await expect(resolveVerificationToken("bad")).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
  });

  it("throws ALREADY_COMPLETED for a used token", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue({
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 10_000),
    });
    await expect(resolveVerificationToken("used")).rejects.toMatchObject({
      code: "ALREADY_COMPLETED",
    });
  });

  it("throws EXPIRED_TOKEN for an expired token", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue({
      completedAt: null,
      expiresAt: new Date(Date.now() - 10_000),
    });
    await expect(resolveVerificationToken("expired")).rejects.toMatchObject({
      code: "EXPIRED_TOKEN",
    });
  });

  it("requires school selection for a district with multiple active schools", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue({
      id: "t1",
      studentId: "student1",
      completedAt: null,
      expiresAt: new Date(Date.now() + 10_000),
      matchedOrganization: {
        id: "district1",
        officialName: "Frisco ISD",
        organizationType: "DISTRICT",
        schools: [
          { id: "s1", officialName: "Frisco High", status: "ACTIVE" },
          { id: "s2", officialName: "Independence High", status: "ACTIVE" },
        ],
      },
    });

    const result = await resolveVerificationToken("t1");
    expect(result.requiresSchoolSelection).toBe(true);
    expect(result.schools).toHaveLength(2);
  });

  it("does not require selection for a single-school organization", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue({
      id: "t1",
      studentId: "student1",
      completedAt: null,
      expiresAt: new Date(Date.now() + 10_000),
      matchedOrganization: {
        id: "school1",
        officialName: "Plano Academy",
        organizationType: "SCHOOL",
        schools: [],
      },
    });

    const result = await resolveVerificationToken("t1");
    expect(result.requiresSchoolSelection).toBe(false);
  });
});

describe("completeSchoolVerification", () => {
  function baseToken(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "t1",
      studentId: "student1",
      requestedEmail: "kid@k12.friscoisd.org",
      completedAt: null,
      expiresAt: new Date(Date.now() + 10_000),
      matchedOrganization: {
        id: "school1",
        status: "ACTIVE",
        organizationType: "SCHOOL",
        schools: [],
      },
      ...overrides,
    };
  }

  it("throws WRONG_ACCOUNT when the logged-in student doesn't match the token", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue(baseToken());

    await expect(
      completeSchoolVerification("raw", "someone-else"),
    ).rejects.toMatchObject({ code: "WRONG_ACCOUNT" });
  });

  it("throws ALREADY_HAS_MEMBERSHIP if a membership was created since the request", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue(baseToken());
    mocked.studentMembership.findUnique.mockResolvedValue({ id: "m1" });
    mocked.user.findUniqueOrThrow.mockResolvedValue({ grade: 10 });

    await expect(completeSchoolVerification("raw", "student1")).rejects.toMatchObject({
      code: "ALREADY_HAS_MEMBERSHIP",
    });
  });

  it("throws NEEDS_SCHOOL_SELECTION for a multi-school district with no schoolId given", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue(
      baseToken({
        matchedOrganization: {
          id: "district1",
          status: "ACTIVE",
          organizationType: "DISTRICT",
          schools: [
            { id: "s1", status: "ACTIVE" },
            { id: "s2", status: "ACTIVE" },
          ],
        },
      }),
    );
    mocked.studentMembership.findUnique.mockResolvedValue(null);
    mocked.user.findUniqueOrThrow.mockResolvedValue({ grade: 10 });

    await expect(completeSchoolVerification("raw", "student1")).rejects.toMatchObject({
      code: "NEEDS_SCHOOL_SELECTION",
    });
  });

  it("throws NEEDS_SCHOOL_SELECTION when the given schoolId isn't in the district", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue(
      baseToken({
        matchedOrganization: {
          id: "district1",
          status: "ACTIVE",
          organizationType: "DISTRICT",
          schools: [
            { id: "s1", status: "ACTIVE" },
            { id: "s2", status: "ACTIVE" },
          ],
        },
      }),
    );
    mocked.studentMembership.findUnique.mockResolvedValue(null);
    mocked.user.findUniqueOrThrow.mockResolvedValue({ grade: 10 });

    await expect(
      completeSchoolVerification("raw", "student1", "not-a-real-school"),
    ).rejects.toMatchObject({ code: "NEEDS_SCHOOL_SELECTION" });
  });

  it("auto-assigns the single school in a district with exactly one active school", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue(
      baseToken({
        matchedOrganization: {
          id: "district1",
          status: "ACTIVE",
          organizationType: "DISTRICT",
          schools: [{ id: "s1", status: "ACTIVE" }],
        },
      }),
    );
    mocked.studentMembership.findUnique.mockResolvedValue(null);
    mocked.user.findUniqueOrThrow.mockResolvedValue({ grade: 10 });
    mocked.schoolVerificationToken.update.mockResolvedValue({});
    mocked.studentMembership.create.mockResolvedValue({});

    await completeSchoolVerification("raw", "student1");

    const createCall = mocked.studentMembership.create.mock.calls[0][0];
    expect(createCall.data.schoolId).toBe("s1");
    expect(createCall.data.organizationId).toBe("district1");
    expect(createCall.data.activationMethod).toBe("SCHOOL_EMAIL_VERIFICATION");
  });

  it("throws PARTNERSHIP_INACTIVE if the org lapsed between request and confirm", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue(
      baseToken({ matchedOrganization: { id: "school1", status: "SUSPENDED", organizationType: "SCHOOL", schools: [] } }),
    );
    mocked.studentMembership.findUnique.mockResolvedValue(null);
    mocked.user.findUniqueOrThrow.mockResolvedValue({ grade: 10 });

    await expect(completeSchoolVerification("raw", "student1")).rejects.toMatchObject({
      code: "PARTNERSHIP_INACTIVE",
    });
  });

  it("calls scheduleSubscriptionNonRenewal (PRD-003 §16) after membership creation succeeds", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue(baseToken());
    mocked.studentMembership.findUnique.mockResolvedValue(null);
    mocked.user.findUniqueOrThrow.mockResolvedValue({ grade: 10 });
    mocked.schoolVerificationToken.update.mockResolvedValue({});
    mocked.studentMembership.create.mockResolvedValue({});

    await completeSchoolVerification("raw", "student1");

    expect(mockedScheduleNonRenewal).toHaveBeenCalledWith("student1");
  });

  it("marks the token completed atomically alongside membership creation", async () => {
    mocked.schoolVerificationToken.findUnique.mockResolvedValue(baseToken());
    mocked.studentMembership.findUnique.mockResolvedValue(null);
    mocked.user.findUniqueOrThrow.mockResolvedValue({ grade: 11 });
    mocked.schoolVerificationToken.update.mockResolvedValue({});
    mocked.studentMembership.create.mockResolvedValue({});

    await completeSchoolVerification("raw", "student1");

    expect(mocked.schoolVerificationToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1" } }),
    );
    const membershipData = mocked.studentMembership.create.mock.calls[0][0].data;
    expect(membershipData.currentGrade).toBe(11);
    expect(membershipData.verifiedSchoolEmail).toBe("kid@k12.friscoisd.org");
  });
});
