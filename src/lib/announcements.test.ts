import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveAnnouncementsForStudents,
  listAnnouncements,
  publishAnnouncement,
  removeAnnouncement,
} from "@/lib/announcements";
import { AdminError } from "@/lib/admin/errors";
import { prisma } from "@/lib/prisma";
import { drainForRequest } from "@/lib/email-queue";

vi.mock("@/lib/prisma", () => {
  // The announcement row and its mail are written in one transaction, so the
  // transaction client is what the publish assertions look at.
  const tx = {
    announcement: { create: vi.fn() },
    queuedEmail: { createMany: vi.fn() },
  };
  const mockPrisma: Record<string, unknown> = {
    announcement: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    organization: { findUniqueOrThrow: vi.fn() },
    studentMembership: { findMany: vi.fn() },
    $transaction: vi.fn(),
    __tx: tx,
  };
  return { prisma: mockPrisma };
});

vi.mock("@/lib/email-queue", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email-queue")>("@/lib/email-queue");
  // queueRows is pure, so the real one is used; only the send is stubbed.
  return { queueRows: actual.queueRows, drainForRequest: vi.fn().mockResolvedValue(undefined) };
});

const mocked = prisma as unknown as {
  announcement: Record<string, ReturnType<typeof vi.fn>>;
  organization: Record<string, ReturnType<typeof vi.fn>>;
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  $transaction: ReturnType<typeof vi.fn>;
  __tx: {
    announcement: Record<string, ReturnType<typeof vi.fn>>;
    queuedEmail: Record<string, ReturnType<typeof vi.fn>>;
  };
};
const mockedDrain = drainForRequest as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocked.organization.findUniqueOrThrow.mockResolvedValue({ officialName: "Lebanon Trail High School" });
  mocked.studentMembership.findMany.mockResolvedValue([]);
  mocked.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(mocked.__tx));
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
  it("refuses an end date that has already passed, before anything is written or mailed", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ verifiedSchoolEmail: "ada@school.edu" }]);

    await expect(
      publishAnnouncement("school1", "admin1", { title: "t", message: "m", expiresAt: new Date(Date.now() - 1000) }),
    ).rejects.toThrow(AdminError);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("creates the announcement and queues mail for every ACTIVE registered student", async () => {
    mocked.__tx.announcement.create.mockResolvedValue({
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
    // One queue row per student, written in the same transaction as the
    // announcement, so the announcement can't exist with no mail behind it.
    expect(mocked.__tx.queuedEmail.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          to: "ada@school.edu",
          kind: "announcement",
          subject: expect.stringContaining("Testing Update"),
        }),
        expect.objectContaining({ to: "grace@school.edu" }),
      ],
    });
    // Then drained from this request, so a small campus gets it at once.
    expect(mockedDrain).toHaveBeenCalled();
  });

  it("still publishes even when there are zero currently-ACTIVE students to email", async () => {
    mocked.__tx.announcement.create.mockResolvedValue({
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
    // Nothing queued rather than an empty insert.
    expect(mocked.__tx.queuedEmail.createMany).not.toHaveBeenCalled();
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
