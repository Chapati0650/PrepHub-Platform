import { prisma } from "@/lib/prisma";
import { drainForRequest, queueRows } from "@/lib/email-queue";
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
// it's immediately visible inside PrepHub) and queue the email to every
// currently ACTIVE registered student at their school email, in one
// transaction. Either both happen or neither does, so there is no state where
// an announcement is live and nothing was ever going to be mailed for it.
//
// The mail goes through the outbound queue rather than straight out through
// the provider. At a 40-student pilot campus the difference is invisible — the
// request-time drain below sends it before this action returns. At district
// scale it is the difference between working and not: two thousand addresses
// is twenty-odd provider calls, which does not fit inside a serverless
// request, and the previous version was killed partway through having sent an
// unknowable subset with no record of which (see lib/email-queue).
export async function publishAnnouncement(
  schoolId: string,
  createdByUserId: string,
  input: PublishAnnouncementInput,
): Promise<AnnouncementEntry> {
  // An end date already behind us would publish an announcement no student
  // ever sees while still emailing every one of them. The form's parser
  // refuses it too; this is the rule, not just a form check.
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new AdminError("INVALID_INPUT", "That end date has already passed. Pick today or a later day, or leave it empty.");
  }

  const [org, memberships] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: schoolId } }),
    prisma.studentMembership.findMany({
      where: { schoolId, status: "ACTIVE" },
      select: { verifiedSchoolEmail: true },
    }),
  ]);

  const announcement = await prisma.$transaction(async (tx) => {
    const created = await tx.announcement.create({
      data: {
        organizationId: schoolId,
        title: input.title,
        message: input.message,
        expiresAt: input.expiresAt,
        createdByUserId,
      },
    });

    const rows = queueRows(
      "announcement",
      memberships.map((m) => m.verifiedSchoolEmail),
      {
        subject: `${org.officialName}: ${input.title}`,
        text: `${input.message}\n\n— Distributed through PrepHub on behalf of ${org.officialName}.`,
      },
    );
    if (rows.length > 0) await tx.queuedEmail.createMany({ data: rows });

    return created;
  });

  // Best-effort, time-boxed, and deliberately outside the transaction: the
  // announcement is already published and its mail already durable, so a
  // provider outage here delays delivery rather than losing it.
  await drainForRequest();

  return toEntry(announcement);
}

// PRD-011 §18 — a soft delete: the row is kept (so it still shows under
// "View previous announcements") but stops appearing to students and no
// longer counts as active. Scoped to `schoolId` so an admin can never remove
// another school's announcement, even by guessing an id.
/**
 * Announcements a district administrator sent to every campus at once (2026-11-09): the same title and
 * message, published within the same minute, on every one of `campusIds`. Listed on the district's
 * Announcements page as one, with the first campus's row standing for all of them.
 */
export async function listDistrictAnnouncements(campusIds: string[]): Promise<AnnouncementEntry[]> {
  if (campusIds.length === 0) return [];
  const rows = await prisma.announcement.findMany({
    where: { organizationId: { in: campusIds } },
    orderBy: { publishedAt: "desc" },
  });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = districtKey(r);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .filter((g) => new Set(g.map((r) => r.organizationId)).size === campusIds.length)
    .map((g) => toEntry(g[0]));
}

function districtKey(r: { title: string; message: string; publishedAt: Date | null }): string {
  return `${r.title}\u0000${r.message}\u0000${r.publishedAt ? Math.floor(r.publishedAt.getTime() / 60_000) : ""}`;
}

/** Takes a district-wide announcement down on every one of `campusIds`, given any one of its rows. */
export async function removeDistrictAnnouncement(campusIds: string[], announcementId: string): Promise<void> {
  const row = await prisma.announcement.findUnique({ where: { id: announcementId } });
  if (!row || !campusIds.includes(row.organizationId)) {
    throw new AdminError("ANNOUNCEMENT_NOT_FOUND", "Announcement not found in this district.");
  }
  const siblings = await prisma.announcement.findMany({
    where: { organizationId: { in: campusIds }, title: row.title, message: row.message, removedAt: null },
    select: { id: true, title: true, message: true, publishedAt: true },
  });
  const key = districtKey(row);
  const ids = siblings.filter((s) => districtKey(s) === key).map((s) => s.id);
  await prisma.announcement.updateMany({ where: { id: { in: ids } }, data: { removedAt: new Date() } });
}

export async function removeAnnouncement(schoolId: string, announcementId: string): Promise<void> {
  const announcement = await prisma.announcement.findUnique({ where: { id: announcementId } });
  if (!announcement || announcement.organizationId !== schoolId) {
    throw new AdminError("ANNOUNCEMENT_NOT_FOUND", "Announcement not found at this school.");
  }

  await prisma.announcement.update({ where: { id: announcementId }, data: { removedAt: new Date() } });
}
