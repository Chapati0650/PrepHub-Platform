import { describe, expect, it, vi, beforeEach } from "vitest";
import { searchOrganizations } from "@/lib/organizations";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findMany: vi.fn() },
  },
}));

const mockFindMany = prisma.organization.findMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFindMany.mockReset();
});

describe("searchOrganizations", () => {
  it("only queries directory-visible organizations", async () => {
    mockFindMany.mockResolvedValue([]);
    await searchOrganizations("");

    const call = mockFindMany.mock.calls[0][0];
    expect(call.where.directoryVisible).toBe(true);
  });

  it("uses a case-insensitive prefix filter when a query is given", async () => {
    mockFindMany.mockResolvedValue([]);
    await searchOrganizations("  frisco  ");

    const call = mockFindMany.mock.calls[0][0];
    expect(call.where.officialName).toEqual({ startsWith: "frisco", mode: "insensitive" });
  });

  it("omits the name filter entirely for an empty query (browse mode)", async () => {
    mockFindMany.mockResolvedValue([]);
    await searchOrganizations("");

    const call = mockFindMany.mock.calls[0][0];
    expect(call.where.officialName).toBeUndefined();
  });

  it("marks ACTIVE organizations as available and others as unavailable", async () => {
    mockFindMany.mockResolvedValue([
      { id: "1", officialName: "Frisco ISD", organizationType: "DISTRICT", status: "ACTIVE" },
      { id: "2", officialName: "Lewisville ISD", organizationType: "DISTRICT", status: "SETUP" },
    ]);

    const results = await searchOrganizations("");
    expect(results).toEqual([
      { id: "1", name: "Frisco ISD", type: "DISTRICT", available: true },
      { id: "2", name: "Lewisville ISD", type: "DISTRICT", available: false },
    ]);
  });

  it("prioritizes available organizations first when browsing without a query", async () => {
    mockFindMany.mockResolvedValue([
      { id: "1", officialName: "Aardvark ISD", organizationType: "DISTRICT", status: "SETUP" },
      { id: "2", officialName: "Zebra ISD", organizationType: "DISTRICT", status: "ACTIVE" },
    ]);

    const results = await searchOrganizations("");
    expect(results.map((r) => r.id)).toEqual(["2", "1"]);
  });

  it("does not reorder search results by availability (already name-sorted by the query)", async () => {
    mockFindMany.mockResolvedValue([
      { id: "1", officialName: "Frisco Academy", organizationType: "SCHOOL", status: "SETUP" },
      { id: "2", officialName: "Frisco ISD", organizationType: "DISTRICT", status: "ACTIVE" },
    ]);

    const results = await searchOrganizations("Frisco");
    expect(results.map((r) => r.id)).toEqual(["1", "2"]);
  });
});
