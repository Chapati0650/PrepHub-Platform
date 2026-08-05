import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createAdministrator,
  assignAdministrator,
  removeAdministratorAssignment,
} from "@/lib/owner/administrators";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    administratorAssignment: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));

const mocked = prisma as unknown as {
  user: Record<string, ReturnType<typeof vi.fn>>;
  administratorAssignment: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAdministrator", () => {
  it("throws EMAIL_TAKEN when the email is already registered", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: "existing" });

    await expect(
      createAdministrator({
        firstName: "Ada",
        email: "ada@example.com",
        password: "hunter2222",
        organizationId: "org1",
        scope: "SCHOOL",
      }),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    expect(mocked.user.create).not.toHaveBeenCalled();
  });

  it("creates a SCHOOL_ADMINISTRATOR with a hashed password and an initial assignment", async () => {
    mocked.user.findUnique.mockResolvedValue(null);
    mocked.user.create.mockResolvedValue({});

    await createAdministrator({
      firstName: "Ada",
      email: "ada@example.com",
      password: "hunter2222",
      organizationId: "org1",
      scope: "DISTRICT",
    });

    const call = mocked.user.create.mock.calls[0][0];
    expect(call.data.role).toBe("SCHOOL_ADMINISTRATOR");
    expect(call.data.passwordHash).not.toBe("hunter2222");
    expect(call.data.adminAssignments.create).toEqual([
      { organizationId: "org1", scope: "DISTRICT" },
    ]);
  });
});

describe("assignAdministrator", () => {
  it("throws ADMINISTRATOR_NOT_FOUND for a non-administrator user", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: "u1", role: "STUDENT" });
    await expect(assignAdministrator("u1", "org1", "SCHOOL")).rejects.toMatchObject({
      code: "ADMINISTRATOR_NOT_FOUND",
    });
  });

  it("upserts the assignment, clearing any prior removal", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: "u1", role: "SCHOOL_ADMINISTRATOR" });
    mocked.administratorAssignment.upsert.mockResolvedValue({});

    await assignAdministrator("u1", "org1", "SCHOOL");

    expect(mocked.administratorAssignment.upsert).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: "u1", organizationId: "org1" } },
      update: { removedAt: null, scope: "SCHOOL" },
      create: { userId: "u1", organizationId: "org1", scope: "SCHOOL" },
    });
  });
});

describe("removeAdministratorAssignment", () => {
  it("throws ADMINISTRATOR_NOT_FOUND when the assignment doesn't exist", async () => {
    mocked.administratorAssignment.findUnique.mockResolvedValue(null);
    await expect(removeAdministratorAssignment("a1")).rejects.toMatchObject({
      code: "ADMINISTRATOR_NOT_FOUND",
    });
  });

  it("sets removedAt without touching other assignments", async () => {
    mocked.administratorAssignment.findUnique.mockResolvedValue({ id: "a1" });
    mocked.administratorAssignment.update.mockResolvedValue({});

    await removeAdministratorAssignment("a1");

    const call = mocked.administratorAssignment.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "a1" });
    expect(call.data.removedAt).toBeInstanceOf(Date);
  });
});
