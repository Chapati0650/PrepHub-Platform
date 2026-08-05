import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSchoolAccessInfo } from "@/lib/admin/access-info";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findUniqueOrThrow: vi.fn() } },
}));

const mocked = prisma as unknown as { organization: { findUniqueOrThrow: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSchoolAccessInfo", () => {
  it("returns status and contract dates without any billing/contract-management detail", async () => {
    mocked.organization.findUniqueOrThrow.mockResolvedValue({
      officialName: "Lebanon Trail High School",
      status: "ACTIVE",
      contractStartDate: new Date("2026-08-01"),
      contractEndDate: new Date("2027-05-31"),
      internalNotes: "confidential pricing notes",
    });

    const result = await getSchoolAccessInfo("school1");

    expect(result).toEqual({
      schoolName: "Lebanon Trail High School",
      status: "ACTIVE",
      contractStartDate: new Date("2026-08-01"),
      contractEndDate: new Date("2027-05-31"),
    });
    expect(JSON.stringify(result)).not.toContain("confidential");
  });
});
