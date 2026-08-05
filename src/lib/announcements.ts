import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { AdminError } from "@/lib/admin/errors";

export type AnnouncementEntry = {
  id: string;
  title: string;
  message: string;
  publishedAt: Date;
  expiresAt: Date | null;
  removedAt: Date | null;
  isActive: boolean;
};

function toEntry(row: {
  id: string;
  title: string;
  message: string;
  publishedAt: Date;
  expiresAt: Date | null;
  removedAt: Date | null;
}): AnnouncementEntry {
  const now = new Date();
  return {
    ...row,
    isActive: !row.removedAt && (!row.expiresAt || row.expiresAt > now),
  };
}

// PRD-011 §18 — the administrator's full history: active and previous
// (removed/expired) announcements, newest first.
export async function listAnnouncements(schoolId: string): Promise<AnnouncementEntry[]> {
  const rows = await prisma.announcement.findMany({
    where: { organizationId: schoolId },
    orderBy: { publishedAt: "desc" },
  });
  return rows.map(toEntry);
}

// PRD-011 §16 — what students actually see inside PrepHub: only currently
// active (not removed, not past its expiration) announcements for their school.
export async function getActiveAnnouncementsForStudents(schoolId: string): Promise<AnnouncementEntry[]> {
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: { organizationId: schoolId, removedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { publishedAt: "desc" },
  });
  return rows.map(toEntry);
}

export type PublishAnnouncementInput = {
  title: string;
  message: string;
  expiresAt?: Date;
};

// PRD-011 §16-§17 — publishing is a single atomic action: create the row (so
// it's immediately visible inside PrepHub), then email every currently ACTIVE
// registered student at their school email. Delivery is best-effort per
// recipient (`sendEmail` never throws — see CLAUDE.md's "optional side
// effects must never block the core operation") so one bad address can't
// stop the announcement from publishing or other students from being emailed.
export async function publishAnnouncement(
  schoolId: string,
  createdByUserId: string,
  input: PublishAnnouncementInput,
): Promise<AnnouncementEntry> {
  const [announcement, org, memberships] = await Promise.all([
    prisma.announcement.create({
      data: {
        organizationId: schoolId,
        title: input.title,
        message: input.message,
        expiresAt: input.expiresAt,
        createdByUserId,
      },
    }),
    prisma.organization.findUniqueOrThrow({ where: { id: schoolId } }),
    prisma.studentMembership.findMany({
      where: { schoolId, status: "ACTIVE" },
      select: { verifiedSchoolEmail: true },
    }),
  ]);

  await Promise.all(
    memberships.map((m) =>
      sendEmail({
        to: m.verifiedSchoolEmail,
        subject: `${org.officialName}: ${input.title}`,
        text: `${input.message}\n\n— Distributed through PrepHub on behalf of ${org.officialName}.`,
      }),
    ),
  );

  return toEntry(announcement);
}

// PRD-011 §18 — a soft delete: the row is kept (so it still shows under
// "View previous announcements") but stops appearing to students and no
// longer counts as active. Scoped to `schoolId` so an admin can never remove
// another school's announcement, even by guessing an id.
export async function removeAnnouncement(schoolId: string, announcementId: string): Promise<void> {
  const announcement = await prisma.announcement.findUnique({ where: { id: announcementId } });
  if (!announcement || announcement.organizationId !== schoolId) {
    throw new AdminError("ANNOUNCEMENT_NOT_FOUND", "Announcement not found at this school.");
  }

  await prisma.announcement.update({ where: { id: announcementId }, data: { removedAt: new Date() } });
}
