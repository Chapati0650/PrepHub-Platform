import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createOrganization,
  updateOrganizationDetails,
  updateTotalEnrollment,
  activateOrganization,
  suspendOrganization,
  archiveOrganization,
  renewOrganization,
  listOrganizations,
} from "@/lib/owner/organizations";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    studentMembership: { count: vi.fn() },
    administratorAssignment: { count: vi.fn() },
  },
}));

const mocked = prisma as unknown as {
  organization: Record<string, ReturnType<typeof vi.fn>>;
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  administratorAssignment: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

const future = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);
const past = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describe("createOrganization", () => {
  it("rejects a DISTRICT with a parentDistrictId", async () => {
    await expect(
      createOrganization({
        organizationType: "DISTRICT",
        officialName: "X",
        city: "X",
        state: "X",
        schoolYear: "2026",
        contractStartDate: past(1),
        contractEndDate: future(1),
        parentDistrictId: "d1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects an end date before the start date", async () => {
    await expect(
      createOrganization({
        organizationType: "SCHOOL",
        officialName: "X",
        city: "X",
        state: "X",
        schoolYear: "2026",
        contractStartDate: future(10),
        contractEndDate: future(1),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("creates in SETUP status regardless of dates", async () => {
    mocked.organization.create.mockResolvedValue({});
    await createOrganization({
      organizationType: "SCHOOL",
      officialName: "X",
      city: "X",
      state: "X",
      schoolYear: "2026",
      contractStartDate: past(1),
      contractEndDate: future(1),
    });

    expect(mocked.organization.create.mock.calls[0][0].data.status).toBe("SETUP");
  });
});

describe("activateOrganization", () => {
  it("throws ORGANIZATION_NOT_FOUND when missing", async () => {
    mocked.organization.findUnique.mockResolvedValue(null);
    await expect(activateOrganization("x")).rejects.toMatchObject({
      code: "ORGANIZATION_NOT_FOUND",
    });
  });

  it("throws CONTRACT_NOT_STARTED when the start date is in the future", async () => {
    mocked.organization.findUnique.mockResolvedValue({
      contractStartDate: future(1),
      contractEndDate: future(10),
    });
    await expect(activateOrganization("x")).rejects.toMatchObject({
      code: "CONTRACT_NOT_STARTED",
    });
  });

  it("throws CONTRACT_EXPIRED when the end date has already passed", async () => {
    mocked.organization.findUnique.mockResolvedValue({
      contractStartDate: past(10),
      contractEndDate: past(1),
    });
    await expect(activateOrganization("x")).rejects.toMatchObject({ code: "CONTRACT_EXPIRED" });
  });

  it("activates when dates are currently in range", async () => {
    mocked.organization.findUnique.mockResolvedValue({
      contractStartDate: past(1),
      contractEndDate: future(1),
    });
    mocked.organization.update.mockResolvedValue({});
    await activateOrganization("x");
    expect(mocked.organization.update).toHaveBeenCalledWith({
      where: { id: "x" },
      data: { status: "ACTIVE" },
    });
  });
});

describe("suspendOrganization / archiveOrganization", () => {
  it("suspend sets status SUSPENDED", async () => {
    mocked.organization.findUnique.mockResolvedValue({});
    mocked.organization.update.mockResolvedValue({});
    await suspendOrganization("x");
    expect(mocked.organization.update).toHaveBeenCalledWith({
      where: { id: "x" },
      data: { status: "SUSPENDED" },
    });
  });

  it("archive sets status ARCHIVED and archivedAt", async () => {
    mocked.organization.findUnique.mockResolvedValue({});
    mocked.organization.update.mockResolvedValue({});
    await archiveOrganization("x");
    const call = mocked.organization.update.mock.calls[0][0];
    expect(call.data.status).toBe("ARCHIVED");
    expect(call.data.archivedAt).toBeInstanceOf(Date);
  });
});

describe("renewOrganization", () => {
  it("rejects an end date before the start date", async () => {
    mocked.organization.findUnique.mockResolvedValue({});
    await expect(renewOrganization("x", future(10), future(1))).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("sets status ACTIVE when the new dates are currently in range", async () => {
    mocked.organization.findUnique.mockResolvedValue({});
    mocked.organization.update.mockResolvedValue({});
    await renewOrganization("x", past(1), future(30));
    expect(mocked.organization.update.mock.calls[0][0].data.status).toBe("ACTIVE");
  });

  it("sets status SETUP when the new start date is still in the future", async () => {
    mocked.organization.findUnique.mockResolvedValue({});
    mocked.organization.update.mockResolvedValue({});
    await renewOrganization("x", future(5), future(30));
    expect(mocked.organization.update.mock.calls[0][0].data.status).toBe("SETUP");
  });
});

describe("updateOrganizationDetails", () => {
  it("throws ORGANIZATION_NOT_FOUND when missing", async () => {
    mocked.organization.findUnique.mockResolvedValue(null);
    await expect(
      updateOrganizationDetails("x", {
        officialName: "X",
        city: "X",
        state: "X",
        schoolYear: "2026",
        contractStartDate: past(1),
        contractEndDate: future(1),
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_NOT_FOUND" });
  });
});

describe("listOrganizations", () => {
  it("counts DISTRICT active students by organizationId and SCHOOL by schoolId", async () => {
    mocked.organization.findMany.mockResolvedValue([
      {
        id: "d1",
        officialName: "District",
        organizationType: "DISTRICT",
        status: "ACTIVE",
        contractStartDate: past(1),
        contractEndDate: future(1),
        updatedAt: new Date(),
      },
      {
        id: "s1",
        officialName: "School",
        organizationType: "SCHOOL",
        status: "ACTIVE",
        contractStartDate: past(1),
        contractEndDate: future(1),
        updatedAt: new Date(),
      },
    ]);
    mocked.studentMembership.count.mockResolvedValue(5);
    mocked.administratorAssignment.count.mockResolvedValue(2);

    const rows = await listOrganizations();

    expect(mocked.studentMembership.count).toHaveBeenCalledWith({
      where: { organizationId: "d1", status: "ACTIVE" },
    });
    expect(mocked.studentMembership.count).toHaveBeenCalledWith({
      where: { schoolId: "s1", status: "ACTIVE" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].activeStudentCount).toBe(5);
    expect(rows[0].administratorCount).toBe(2);
  });
});

describe("updateTotalEnrollment", () => {
  it("sets Total School Enrollment for a SCHOOL org", async () => {
    mocked.organization.findUnique.mockResolvedValue({ id: "s1", organizationType: "SCHOOL" });

    await updateTotalEnrollment("s1", 2100);

    expect(mocked.organization.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { totalEnrollment: 2100 },
    });
  });

  it("allows clearing the value back to null", async () => {
    mocked.organization.findUnique.mockResolvedValue({ id: "s1", organizationType: "SCHOOL" });

    await updateTotalEnrollment("s1", null);

    expect(mocked.organization.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { totalEnrollment: null },
    });
  });

  it("rejects a DISTRICT org — only schools have a Total School Enrollment", async () => {
    mocked.organization.findUnique.mockResolvedValue({ id: "d1", organizationType: "DISTRICT" });

    await expect(updateTotalEnrollment("d1", 2100)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocked.organization.update).not.toHaveBeenCalled();
  });

  it("rejects a negative enrollment figure", async () => {
    mocked.organization.findUnique.mockResolvedValue({ id: "s1", organizationType: "SCHOOL" });

    await expect(updateTotalEnrollment("s1", -1)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects an unknown organization", async () => {
    mocked.organization.findUnique.mockResolvedValue(null);

    await expect(updateTotalEnrollment("missing", 100)).rejects.toMatchObject({ code: "ORGANIZATION_NOT_FOUND" });
  });
});
