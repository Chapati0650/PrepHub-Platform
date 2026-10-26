import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { inviteTeacher, removeTeacher } from "@/lib/teacher/accounts";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
    teacherAssignment: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    classroom: { updateMany: vi.fn() },
    passwordResetToken: { create: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

const mocked = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const SCHOOL = { id: "school1", officialName: "Northwest HS", organizationType: "SCHOOL" };
const input = { firstName: " Rosa ", email: " Rosa@NISD.net ", schoolId: "school1", invitedBy: "Northwest HS's PrepHub administrator" };

beforeEach(() => {
  vi.clearAllMocks();
  mocked.organization.findUnique.mockResolvedValue(SCHOOL);
});

describe("inviteTeacher", () => {
  it("creates a teacher account at the school and emails a week-long set-password link", async () => {
    mocked.user.findUnique.mockResolvedValue(null);
    mocked.user.create.mockResolvedValue({ id: "t1", email: "rosa@nisd.net", firstName: "Rosa" });

    expect(await inviteTeacher(input)).toEqual({ userId: "t1", created: true, restoredClasses: 0 });

    const created = mocked.user.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ role: "TEACHER", firstName: "Rosa", email: "rosa@nisd.net" });
    expect(created).not.toHaveProperty("passwordHash"); // nobody chose a password for them
    expect(created.teacherAssignments).toEqual({ create: { schoolId: "school1" } });

    const sent = vi.mocked(sendEmail).mock.calls[0][0];
    expect(sent.to).toBe("rosa@nisd.net");
    const raw = sent.text.match(/\/reset-password\/([0-9a-f]{64})/)?.[1];
    expect(raw).toBeTruthy();
    const token = mocked.passwordResetToken.create.mock.calls[0][0].data;
    expect(token.token).toBe(createHash("sha256").update(raw!).digest("hex"));
    const days = (token.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
  });

  it("never turns a student or administrator account into a teacher, and says who can", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: "u1", role: "STUDENT", deletedAt: null, teacherAssignments: [] });
    const refused = inviteTeacher(input);
    await expect(refused).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    await expect(refused).rejects.toThrow("schools@prephubtp.com");
    expect(mocked.teacherAssignment.upsert).not.toHaveBeenCalled();
    expect(mocked.user.create).not.toHaveBeenCalled();
  });

  it("won't add a teacher who teaches at another school", async () => {
    mocked.user.findUnique.mockResolvedValue({
      id: "t1",
      role: "TEACHER",
      deletedAt: null,
      teacherAssignments: [{ schoolId: "other", removedAt: null }],
    });
    await expect(inviteTeacher(input)).rejects.toThrow("another school");
  });

  it("says so, and changes nothing, for someone who is already a teacher here", async () => {
    mocked.user.findUnique.mockResolvedValue({
      id: "t1",
      role: "TEACHER",
      firstName: "Rosa",
      deletedAt: null,
      teacherAssignments: [{ schoolId: "school1", removedAt: null }],
    });
    await expect(inviteTeacher(input)).rejects.toMatchObject({ code: "ALREADY_TEACHER" });
    expect(mocked.teacherAssignment.upsert).not.toHaveBeenCalled();
    expect(mocked.teacherAssignment.update).not.toHaveBeenCalled();
    expect(mocked.classroom.updateMany).not.toHaveBeenCalled();
  });

  it("restores a removed teacher and reopens exactly the classes their removal closed", async () => {
    const removedAt = new Date("2026-10-20T15:00:00Z");
    mocked.user.findUnique.mockResolvedValue({
      id: "t1",
      role: "TEACHER",
      deletedAt: null,
      teacherAssignments: [{ schoolId: "school1", removedAt }],
    });
    mocked.classroom.updateMany.mockResolvedValue({ count: 2 });

    expect(await inviteTeacher(input)).toEqual({ userId: "t1", created: false, restoredClasses: 2 });
    expect(mocked.teacherAssignment.update.mock.calls[0][0]).toMatchObject({ data: { removedAt: null } });
    // Same instant as the removal: a class the teacher archived themselves stays archived.
    expect(mocked.classroom.updateMany.mock.calls[0][0]).toEqual({
      where: { teacherId: "t1", schoolId: "school1", archivedAt: removedAt },
      data: { archivedAt: null },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocked.user.create).not.toHaveBeenCalled();
  });

  it("adds an existing teacher account with no history at this school, without a second account", async () => {
    mocked.user.findUnique.mockResolvedValue({ id: "t1", role: "TEACHER", deletedAt: null, teacherAssignments: [] });

    expect(await inviteTeacher(input)).toEqual({ userId: "t1", created: false, restoredClasses: 0 });
    expect(mocked.teacherAssignment.upsert.mock.calls[0][0]).toMatchObject({ create: { userId: "t1", schoolId: "school1" } });
    expect(mocked.user.create).not.toHaveBeenCalled();
  });

  it("only adds teachers to a school, not a district", async () => {
    mocked.organization.findUnique.mockResolvedValue({ ...SCHOOL, organizationType: "DISTRICT" });
    await expect(inviteTeacher(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a malformed email before touching anything", async () => {
    await expect(inviteTeacher({ ...input, email: "not an email" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocked.organization.findUnique).not.toHaveBeenCalled();
  });
});

describe("removeTeacher", () => {
  it("ends access and closes their classes at that school, together, deleting nothing", async () => {
    await removeTeacher("t1", "school1");
    expect(mocked.teacherAssignment.updateMany.mock.calls[0][0].where).toEqual({ userId: "t1", schoolId: "school1", removedAt: null });
    expect(mocked.classroom.updateMany.mock.calls[0][0].where).toEqual({ teacherId: "t1", schoolId: "school1", archivedAt: null });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("stamps the access and the classes with the same instant, which is how adding them back finds those classes", async () => {
    await removeTeacher("t1", "school1");
    const removedAt = mocked.teacherAssignment.updateMany.mock.calls[0][0].data.removedAt;
    expect(mocked.classroom.updateMany.mock.calls[0][0].data.archivedAt).toBe(removedAt);
  });
});
