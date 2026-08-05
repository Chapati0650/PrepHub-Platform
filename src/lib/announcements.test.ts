import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveAnnouncementsForStudents,
  listAnnouncements,
  publishAnnouncement,
  removeAnnouncement,
} from "@/lib/announcements";
import { AdminError } from "@/lib/admin/errors";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    announcement: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    organization: { findUniqueOrThrow: vi.fn() },
    studentMembership: { findMany: vi.fn() },
  };
  return { prisma: mockPrisma };
});

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

const mocked = prisma as unknown as {
  announcement: Record<string, ReturnType<typeof vi.fn>>;
  organization: Record<string, ReturnType<typeof vi.fn>>;
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
};
const mockedSendEmail = sendEmail as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocked.organization.findUniqueOrThrow.mockResolvedValue({ officialName: "Lebanon Trail High School" });
  mocked.studentMembership.findMany.mockResolvedValue([]);
});

describe("listAnnouncements", () => {
  it("marks a removed announcement as inactive", async () => {
    mocked.announcement.findMany.mockResolvedValue([
      { id: "a1", title: "t", message: "m", publishedAt: new Date(), expiresAt: null, removedAt: new Date() },
    ]);

    const result = await listAnnouncements("school1");

    expect(result[0].isActive).toBe(false);
  });

  it("marks an expired announcement as inactive", async () => {
    mocked.announcement.findMany.mockResolvedValue([
      {
        id: "a1",
        title: "t",
        message: "m",
        publishedAt: new Date(Date.now() - 10000),
        expiresAt: new Date(Date.now() - 1000),
        removedAt: null,
      },
    ]);

    const result = await listAnnouncements("school1");

    expect(result[0].isActive).toBe(false);
  });

  it("marks a live, unexpired announcement as active", async () => {
    mocked.announcement.findMany.mockResolvedValue([
      { id: "a1", title: "t", message: "m", publishedAt: new Date(), expiresAt: null, removedAt: null },
    ]);

    const result = await listAnnouncements("school1");

    expect(result[0].isActive).toBe(true);
  });
});

describe("getActiveAnnouncementsForStudents", () => {
  it("queries only non-removed, non-expired announcements for the school", async () => {
    mocked.announcement.findMany.mockResolvedValue([]);

    await getActiveAnnouncementsForStudents("school1");

    expect(mocked.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "school1", removedAt: null }),
      }),
    );
  });
});

describe("publishAnnouncement", () => {
  it("creates the announcement and emails every ACTIVE registered student at their school email", async () => {
    mocked.announcement.create.mockResolvedValue({
      id: "a1",
      title: "Testing Update",
      message: "Good luck!",
      publishedAt: new Date(),
      expiresAt: null,
      removedAt: null,
    });
    mocked.studentMembership.findMany.mockResolvedValue([
      { verifiedSchoolEmail: "ada@school.edu" },
      { verifiedSchoolEmail: "grace@school.edu" },
    ]);

    await publishAnnouncement("school1", "admin1", { title: "Testing Update", message: "Good luck!" });

    expect(mocked.studentMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: "school1", status: "ACTIVE" } }),
    );
    expect(mockedSendEmail).toHaveBeenCalledTimes(2);
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ada@school.edu", subject: expect.stringContaining("Testing Update") }),
    );
  });

  it("still publishes even when there are zero currently-ACTIVE students to email", async () => {
    mocked.announcement.create.mockResolvedValue({
      id: "a1",
      title: "t",
      message: "m",
      publishedAt: new Date(),
      expiresAt: null,
      removedAt: null,
    });
    mocked.studentMembership.findMany.mockResolvedValue([]);

    const result = await publishAnnouncement("school1", "admin1", { title: "t", message: "m" });

    expect(result.id).toBe("a1");
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });
});

describe("removeAnnouncement", () => {
  it("soft-removes an announcement belonging to this school", async () => {
    mocked.announcement.findUnique.mockResolvedValue({ id: "a1", organizationId: "school1" });

    await removeAnnouncement("school1", "a1");

    expect(mocked.announcement.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { removedAt: expect.any(Date) },
    });
  });

  it("refuses to remove an announcement belonging to a different school", async () => {
    mocked.announcement.findUnique.mockResolvedValue({ id: "a1", organizationId: "other-school" });

    await expect(removeAnnouncement("school1", "a1")).rejects.toThrow(AdminError);
    expect(mocked.announcement.update).not.toHaveBeenCalled();
  });

  it("refuses to remove an announcement that does not exist", async () => {
    mocked.announcement.findUnique.mockResolvedValue(null);

    await expect(removeAnnouncement("school1", "missing")).rejects.toThrow(AdminError);
  });
});
