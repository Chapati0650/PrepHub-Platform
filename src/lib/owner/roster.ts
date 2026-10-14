import { prisma } from "@/lib/prisma";
import { parseRoster, type ParsedRoster, type RosterCampus } from "@/lib/owner/roster-parse";

/**
 * The Owner-facing roster: who a district says is eligible for its PrepHub
 * access. Parsing lives in `roster-parse.ts`; this file is the database side.
 *
 * Nothing here creates an account. A roster entry says "this person is one of
 * ours" — the student still signs up themselves and is recognised when they
 * do (see `src/lib/district/enrollment.ts`). That keeps PrepHub out of
 * credential custody for minors and keeps the data a district shares to the
 * minimum needed to answer the eligibility question.
 */

export class RosterError extends Error {}

async function loadCampuses(organizationId: string): Promise<RosterCampus[]> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      officialName: true,
      organizationType: true,
      schools: { select: { id: true, officialName: true }, orderBy: { officialName: "asc" } },
    },
  });
  if (!org) throw new RosterError("That organization no longer exists.");
  return org.organizationType === "DISTRICT"
    ? org.schools
    : [{ id: org.id, officialName: org.officialName }];
}

export type RosterPreview = {
  parsed: ParsedRoster;
  /** Not currently on the roster — these would be added. */
  toAdd: number;
  /** Already on the roster; re-uploading refreshes name/year/campus. */
  toUpdate: number;
  /** On the roster but absent from this upload, so untouched by it. */
  untouched: number;
  campuses: RosterCampus[];
  /** Of the addresses in this upload, how many already have a PrepHub account. */
  alreadyRegistered: number;
};

/**
 * What *would* happen, computed without writing anything. The Owner sees this
 * before committing: a roster upload that silently moved students between
 * campuses or dropped rows would be very hard to notice afterwards.
 */
export async function previewRosterUpload(organizationId: string, input: string): Promise<RosterPreview> {
  const campuses = await loadCampuses(organizationId);
  const parsed = parseRoster(input, campuses);
  const emails = parsed.rows.map((r) => r.email);

  const [existing, registered, totalActive] = await Promise.all([
    prisma.schoolRosterEntry.findMany({
      where: { organizationId, email: { in: emails } },
      select: { email: true },
    }),
    prisma.user.count({ where: { email: { in: emails } } }),
    prisma.schoolRosterEntry.count({ where: { organizationId, removedAt: null } }),
  ]);

  const existingSet = new Set(existing.map((e) => e.email));
  const toUpdate = emails.filter((e) => existingSet.has(e)).length;
  return {
    parsed,
    toAdd: emails.length - toUpdate,
    toUpdate,
    untouched: Math.max(0, totalActive - toUpdate),
    campuses,
    alreadyRegistered: registered,
  };
}

/**
 * Writes the upload. Additive by design: an upload never removes anyone who
 * isn't in it, because a district sending one campus's list should not
 * silently revoke every other campus. Removal is a separate, explicit action.
 *
 * Re-uploading an address un-removes it — the natural reading of "they're on
 * the list again".
 */
export async function commitRosterUpload(
  organizationId: string,
  input: string,
): Promise<{ added: number; updated: number; skipped: number }> {
  const campuses = await loadCampuses(organizationId);
  const parsed = parseRoster(input, campuses);
  if (parsed.rows.length === 0) {
    throw new RosterError("Nothing to upload — no valid rows were found.");
  }

  const existing = await prisma.schoolRosterEntry.findMany({
    where: { organizationId, email: { in: parsed.rows.map((r) => r.email) } },
    select: { email: true },
  });
  const existingSet = new Set(existing.map((e) => e.email));

  // Chunked rather than one giant transaction: a district roster can run to
  // thousands of rows, and a single transaction that size holds locks far
  // longer than this operation deserves.
  const CHUNK = 200;
  for (let i = 0; i < parsed.rows.length; i += CHUNK) {
    const chunk = parsed.rows.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.schoolRosterEntry.upsert({
          where: { organizationId_email: { organizationId, email: row.email } },
          create: {
            organizationId,
            schoolId: row.schoolId,
            email: row.email,
            firstName: row.firstName,
            graduationYear: row.graduationYear,
            externalStudentId: row.externalStudentId,
          },
          update: {
            schoolId: row.schoolId,
            firstName: row.firstName,
            graduationYear: row.graduationYear,
            externalStudentId: row.externalStudentId,
            removedAt: null,
          },
        }),
      ),
    );
  }

  const updated = parsed.rows.filter((r) => existingSet.has(r.email)).length;
  return { added: parsed.rows.length - updated, updated, skipped: parsed.errors.length };
}

export type RosterListEntry = {
  id: string;
  email: string;
  firstName: string | null;
  graduationYear: number | null;
  campusName: string;
  removedAt: Date | null;
  /** Has this person signed up yet? This is the number that matters in a pilot. */
  joined: boolean;
};

export async function listRoster(organizationId: string, limit = 500): Promise<{
  entries: RosterListEntry[];
  total: number;
  joined: number;
}> {
  const [rows, total] = await Promise.all([
    prisma.schoolRosterEntry.findMany({
      where: { organizationId },
      orderBy: [{ removedAt: "asc" }, { email: "asc" }],
      take: limit,
      include: { school: { select: { officialName: true } } },
    }),
    prisma.schoolRosterEntry.count({ where: { organizationId } }),
  ]);

  // "Joined" is membership, not merely having an account: a person could have
  // signed up before their district was a partner.
  const memberships = await prisma.studentMembership.findMany({
    where: { organizationId, verifiedSchoolEmail: { in: rows.map((r) => r.email) } },
    select: { verifiedSchoolEmail: true },
  });
  const joinedSet = new Set(memberships.map((m) => m.verifiedSchoolEmail));

  return {
    entries: rows.map((r) => ({
      id: r.id,
      email: r.email,
      firstName: r.firstName,
      graduationYear: r.graduationYear,
      campusName: r.school.officialName,
      removedAt: r.removedAt,
      joined: joinedSet.has(r.email),
    })),
    total,
    joined: await prisma.studentMembership.count({ where: { organizationId, status: "ACTIVE" } }),
  };
}

/**
 * Takes someone off the roster. Soft, never a delete, so the record of why
 * their access ended survives (CLAUDE.md: deletion is anonymizing, not
 * row-removal).
 *
 * Deliberately does *not* yet revoke an existing membership — that lifecycle
 * step is its own piece of work, and quietly cutting a student's access from
 * inside an upload screen would be the wrong place for it.
 */
export async function removeRosterEntry(organizationId: string, entryId: string): Promise<void> {
  const entry = await prisma.schoolRosterEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.organizationId !== organizationId) {
    throw new RosterError("That roster entry doesn't belong to this organization.");
  }
  await prisma.schoolRosterEntry.update({ where: { id: entryId }, data: { removedAt: new Date() } });
}

const MODES = new Set(["DOMAIN", "ROSTER", "ROSTER_OR_DOMAIN"]);

/** Switches how this organization decides who is eligible. */
export async function setEnrollmentMode(organizationId: string, mode: string): Promise<void> {
  if (!MODES.has(mode)) throw new RosterError("Unknown enrollment mode.");
  await prisma.organization.update({
    where: { id: organizationId },
    data: { enrollmentMode: mode as "DOMAIN" | "ROSTER" | "ROSTER_OR_DOMAIN" },
  });
}
