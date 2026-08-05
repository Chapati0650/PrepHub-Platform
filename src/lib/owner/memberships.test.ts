import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  manuallyActivateStudent,
  removeMembership,
  restoreMembership,
  updateGraduationInfo,
  markGraduated,
  resolveSchoolTransfer,
  listMemberships,
} from "@/lib/owner/memberships";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    studentMembership: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    membershipHistoryEvent: { create: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}));

const mocked = prisma as unknown as {
  user: Record<string, ReturnType<typeof vi.fn>>;
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  membershipHistoryEvent: Record<string, ReturnType<typeof vi.fn>>;
  organization: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manuallyActivateStudent", () => {
  const input = {
    studentEmail: "kid@example.com",
    organizationId: "org1",
    schoolId: "school1",
    verifiedSchoolEmail: "kid@k12.example.org",
    currentGrade: 10,
    expectedGraduationYear: 2028,
  };

  it("throws STUDENT_NOT_FOUND when there's no matching student account", async () => {
    mocked.user.findUnique.mockResolvedValue(null);
    await expect(manuallyActivateStudent(input)).rejects.toMatchObject({
      code: "STUDENT_NOT_FOUND",
    });
  });

  it("throws STUDENT_NOT_FOUND when the account isn't a STUDENT", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: "u1", role: "SCHOOL_ADMINISTRATOR" });
    await expect(manuallyActivateStudent(input)).rejects.toMatchObject({
      code: "STUDENT_NOT_FOUND",
    });
  });

  it("throws ALREADY_HAS_MEMBERSHIP when one already exists", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: "u1", role: "STUDENT" });
    mocked.studentMembership.findUnique.mockResolvedValue({ id: "m1" });
    await expect(manuallyActivateStudent(input)).rejects.toMatchObject({
      code: "ALREADY_HAS_MEMBERSHIP",
    });
  });

  it("creates the membership with OWNER_OVERRIDE and records history", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: "u1", role: "STUDENT" });
    mocked.studentMembership.findUnique.mockResolvedValue(null);
    mocked.studentMembership.create.mockResolvedValue({ id: "m1" });
    mocked.membershipHistoryEvent.create.mockResolvedValue({});

    await manuallyActivateStudent(input);

    const createCall = mocked.studentMembership.create.mock.calls[0][0];
    expect(createCall.data.activationMethod).toBe("OWNER_OVERRIDE");
    expect(createCall.data.studentId).toBe("u1");
    expect(mocked.membershipHistoryEvent.create).toHaveBeenCalledWith({
      data: { membershipId: "m1", eventType: "OWNER_OVERRIDE_ACTIVATION", newOrganizationId: "org1" },
    });
  });
});

describe("removeMembership", () => {
  it("throws MEMBERSHIP_NOT_FOUND when missing", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(null);
    await expect(removeMembership("m1", "owner1")).rejects.toMatchObject({
      code: "MEMBERSHIP_NOT_FOUND",
    });
  });

  it("sets status REMOVED and records history with the reason", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue({ id: "m1" });
    mocked.studentMembership.update.mockResolvedValue({});
    mocked.membershipHistoryEvent.create.mockResolvedValue({});

    await removeMembership("m1", "owner1", "requested by parent");

    expect(mocked.studentMembership.update.mock.calls[0][0].data.status).toBe("REMOVED");
    expect(mocked.membershipHistoryEvent.create).toHaveBeenCalledWith({
      data: {
        membershipId: "m1",
        eventType: "REMOVAL",
        performedByAccountId: "owner1",
        optionalReason: "requested by parent",
      },
    });
  });
});

describe("restoreMembership", () => {
  it("throws when the membership isn't currently REMOVED", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue({
      status: "ACTIVE",
      organization: { status: "ACTIVE" },
    });
    await expect(restoreMembership("m1", "owner1")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("throws when the organization isn't ACTIVE", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue({
      status: "REMOVED",
      organization: { status: "SUSPENDED" },
    });
    await expect(restoreMembership("m1", "owner1")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("reactivates the existing row rather than creating a new one", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue({
      status: "REMOVED",
      organization: { status: "ACTIVE" },
    });
    mocked.studentMembership.update.mockResolvedValue({});
    mocked.membershipHistoryEvent.create.mockResolvedValue({});

    await restoreMembership("m1", "owner1");

    expect(mocked.studentMembership.create).not.toHaveBeenCalled();
    const call = mocked.studentMembership.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "m1" });
    expect(call.data.status).toBe("ACTIVE");
  });
});

describe("updateGraduationInfo / markGraduated", () => {
  it("updateGraduationInfo throws MEMBERSHIP_NOT_FOUND when missing", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(null);
    await expect(updateGraduationInfo("m1", 11, 2027)).rejects.toMatchObject({
      code: "MEMBERSHIP_NOT_FOUND",
    });
  });

  it("updateGraduationInfo updates grade and graduation year", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue({ id: "m1" });
    mocked.studentMembership.update.mockResolvedValue({});
    await updateGraduationInfo("m1", 11, 2027);
    expect(mocked.studentMembership.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { currentGrade: 11, expectedGraduationYear: 2027 },
    });
  });

  it("markGraduated sets status GRADUATED and records history", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue({ id: "m1" });
    mocked.studentMembership.update.mockResolvedValue({});
    mocked.membershipHistoryEvent.create.mockResolvedValue({});

    await markGraduated("m1", "owner1");

    expect(mocked.studentMembership.update.mock.calls[0][0].data.status).toBe("GRADUATED");
    expect(mocked.membershipHistoryEvent.create).toHaveBeenCalledWith({
      data: { membershipId: "m1", eventType: "GRADUATION", performedByAccountId: "owner1" },
    });
  });
});

describe("resolveSchoolTransfer", () => {
  it("throws MEMBERSHIP_NOT_FOUND when missing", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(null);
    await expect(
      resolveSchoolTransfer("m1", "org2", "school2", "kid@newschool.org", "owner1"),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_NOT_FOUND" });
  });

  it("updates the same row in place and records the previous/new org in history", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue({
      id: "m1",
      organizationId: "org1",
    });
    mocked.studentMembership.update.mockResolvedValue({});
    mocked.membershipHistoryEvent.create.mockResolvedValue({});

    await resolveSchoolTransfer("m1", "org2", "school2", "kid@newschool.org", "owner1");

    const updateCall = mocked.studentMembership.update.mock.calls[0][0];
    expect(updateCall.data.organizationId).toBe("org2");
    expect(updateCall.data.schoolId).toBe("school2");
    expect(updateCall.data.status).toBe("ACTIVE");
    expect(mocked.membershipHistoryEvent.create).toHaveBeenCalledWith({
      data: {
        membershipId: "m1",
        eventType: "MANUAL_TRANSFER",
        performedByAccountId: "owner1",
        previousOrganizationId: "org1",
        newOrganizationId: "org2",
      },
    });
  });
});

describe("listMemberships", () => {
  it("throws ORGANIZATION_NOT_FOUND when missing", async () => {
    mocked.organization.findUnique.mockResolvedValue(null);
    await expect(listMemberships("org1")).rejects.toMatchObject({
      code: "ORGANIZATION_NOT_FOUND",
    });
  });

  it("filters by organizationId for a DISTRICT", async () => {
    mocked.organization.findUnique.mockResolvedValue({ organizationType: "DISTRICT" });
    mocked.studentMembership.findMany.mockResolvedValue([]);
    await listMemberships("district1");
    expect(mocked.studentMembership.findMany.mock.calls[0][0].where).toEqual({
      organizationId: "district1",
    });
  });

  it("filters by schoolId for a SCHOOL", async () => {
    mocked.organization.findUnique.mockResolvedValue({ organizationType: "SCHOOL" });
    mocked.studentMembership.findMany.mockResolvedValue([]);
    await listMemberships("school1");
    expect(mocked.studentMembership.findMany.mock.calls[0][0].where).toEqual({
      schoolId: "school1",
    });
  });
});
