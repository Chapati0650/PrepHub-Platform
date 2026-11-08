import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdminSchoolContext, requireAdminWriteContext, schoolField } from "./school-context";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logUnauthorizedAccess: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findMany: vi.fn() },
    administratorAssignment: { findFirst: vi.fn() },
  },
}));

const mocked = prisma as unknown as {
  organization: { findMany: ReturnType<typeof vi.fn> };
  administratorAssignment: { findFirst: ReturnType<typeof vi.fn> };
};
const authMock = auth as unknown as ReturnType<typeof vi.fn>;

const DISTRICT = { organization: { id: "d1", officialName: "Demo ISD" } };
const CHOOSE = { error: "Choose a campus first, then try again." };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1", role: "SCHOOL_ADMINISTRATOR" } });
  mocked.organization.findMany.mockResolvedValue([
    { id: "c1", officialName: "North" },
    { id: "c2", officialName: "South" },
  ]);
});

function districtAdmin() {
  mocked.administratorAssignment.findFirst.mockImplementation(({ where }: { where: { scope?: string } }) =>
    Promise.resolve(where.scope === "DISTRICT" ? DISTRICT : null),
  );
}
function campusAdmin() {
  mocked.administratorAssignment.findFirst.mockImplementation(({ where }: { where: { scope?: string } }) =>
    Promise.resolve(where.scope === "DISTRICT" ? null : { organizationId: "c9" }),
  );
}

describe("requireAdminSchoolContext, district administrator", () => {
  it("resolves to the district and its campuses with no campus chosen", async () => {
    districtAdmin();
    const ctx = await requireAdminSchoolContext();
    expect(ctx.schoolId).toBeNull();
    expect(ctx.district).toEqual({
      id: "d1",
      name: "Demo ISD",
      campuses: [
        { id: "c1", name: "North" },
        { id: "c2", name: "South" },
      ],
    });
    expect(ctx.carryCampusParam).toBe(true);
    expect(ctx.viewingAsOwner).toBe(false);
    expect(mocked.organization.findMany.mock.calls[0][0].where).toEqual({
      organizationType: "SCHOOL",
      parentDistrictId: "d1",
    });
  });

  it("picks a campus of the district", async () => {
    districtAdmin();
    expect((await requireAdminSchoolContext("c2")).schoolId).toBe("c2");
  });

  it("refuses a school outside the district: no campus, not a fallback", async () => {
    districtAdmin();
    expect((await requireAdminSchoolContext("someone-elses-school")).schoolId).toBeNull();
  });
});

describe("requireAdminSchoolContext, campus administrator", () => {
  it("keeps the assignment's school and ignores the requested one", async () => {
    campusAdmin();
    const ctx = await requireAdminSchoolContext("c1");
    expect(ctx.schoolId).toBe("c9");
    expect(ctx.district).toBeNull();
    expect(ctx.carryCampusParam).toBe(false);
  });

  it("has no school without an assignment", async () => {
    mocked.administratorAssignment.findFirst.mockResolvedValue(null);
    expect((await requireAdminSchoolContext()).schoolId).toBeNull();
  });
});

describe("requireAdminWriteContext", () => {
  it("lets a district administrator act on the campus named in the form's school field", async () => {
    districtAdmin();
    expect(await requireAdminWriteContext("c1")).toEqual({ schoolId: "c1", userId: "u1" });
  });

  it("refuses a campus outside the district", async () => {
    districtAdmin();
    expect(await requireAdminWriteContext("foreign")).toEqual(CHOOSE);
  });

  it("asks a district administrator whose form has no school field to choose a campus", async () => {
    districtAdmin();
    expect(await requireAdminWriteContext()).toEqual(CHOOSE);
    expect(await requireAdminWriteContext(null)).toEqual(CHOOSE);
    expect(await requireAdminWriteContext("")).toEqual(CHOOSE);
  });

  it("keeps a campus administrator on their own school even if the form names another", async () => {
    campusAdmin();
    expect(await requireAdminWriteContext("c1")).toEqual({ schoolId: "c9", userId: "u1" });
  });

  it("refuses the Owner's read-only preview", async () => {
    authMock.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    mocked.organization.findMany.mockResolvedValue([{ id: "c1", officialName: "North" }]);
    expect(await requireAdminWriteContext("c1")).toEqual({
      error: "This is a read-only preview of the administrator view.",
    });
  });
});

describe("schoolField", () => {
  it("reads a non-empty string school field only", () => {
    const fd = new FormData();
    expect(schoolField(fd)).toBeNull();
    fd.set("school", "");
    expect(schoolField(fd)).toBeNull();
    fd.set("school", "c1");
    expect(schoolField(fd)).toBe("c1");
  });
});
