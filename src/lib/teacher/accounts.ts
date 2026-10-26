import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { SCHOOLS_CONTACT_EMAIL } from "@/components/marketing/site-chrome";
import { TeacherError } from "./errors";

/**
 * Teacher accounts (2026-10-24). Created by the Owner or by the school's own
 * Administrator — never by signup — and always at one school.
 *
 * A new teacher gets an email with a link to set their password: the person
 * creating the account never chooses or sees it, unlike an Administrator's
 * Owner-set password, because an Administrator inviting a colleague should
 * not hold that colleague's credentials. The link is an ordinary password
 * reset token with a longer life, so it lands on the existing, tested
 * /reset-password page. A teacher whose school uses Google can ignore it and
 * sign in with Google instead — the address is the account.
 */

/** A week: invitations get read on Monday mornings, not within the hour a reset allows. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function siteUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendInvite(user: { id: string; email: string; firstName: string }, schoolName: string, invitedBy: string) {
  const raw = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: { userId: user.id, token: hashToken(raw), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });
  await sendEmail({
    to: user.email,
    subject: `You're set up to teach on PrepHub at ${schoolName}`,
    text: `Hi ${user.firstName},

${invitedBy} has set you up as a teacher at ${schoolName} on PrepHub. You can create classes, give students a code to join, assign SAT practice as homework, and see how each student did on it.

Set your password to get started (the link lasts a week):

${siteUrl()}/reset-password/${raw}

If your school uses Google, you can skip that and choose "Continue with Google" on the log-in page with this email address instead.

— Prithvi, PrepHub`,
  });
}

/**
 * Adds a teacher at a school, creating the account if there isn't one.
 *
 * A teacher removed from this school is restored, and so are the classes the
 * removal closed: `removeTeacher` stamps the assignment's `removedAt` and those
 * classes' `archivedAt` with the same instant, so exactly those reopen — a
 * class the teacher had archived themselves stays archived. `restoredClasses`
 * says how many, for the confirmation.
 *
 * Someone who is already a teacher here is refused with ALREADY_TEACHER, a
 * TeacherError rather than a quiet success, so every caller says so instead of
 * claiming to have added them.
 */
export async function inviteTeacher(input: {
  firstName: string;
  email: string;
  schoolId: string;
  invitedBy: string;
}): Promise<{ userId: string; created: boolean; restoredClasses: number }> {
  const firstName = input.firstName.trim();
  const email = input.email.trim().toLowerCase();
  if (!firstName) throw new TeacherError("INVALID_INPUT", "Enter the teacher's first name.");
  if (!EMAIL_SHAPE.test(email)) throw new TeacherError("INVALID_INPUT", "Enter a valid email address.");

  const school = await prisma.organization.findUnique({
    where: { id: input.schoolId },
    select: { id: true, officialName: true, organizationType: true },
  });
  if (!school || school.organizationType !== "SCHOOL") throw new TeacherError("NOT_FOUND", "School not found.");

  const existing = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      role: true,
      firstName: true,
      email: true,
      deletedAt: true,
      teacherAssignments: { select: { schoolId: true, removedAt: true } },
    },
  });

  if (existing) {
    // Most often the teacher's own student account, made with the same school
    // address. Turning an account into a teacher's is a change to someone's
    // identity that PrepHub makes by hand, never from this form.
    if (existing.deletedAt || existing.role !== "TEACHER") {
      throw new TeacherError(
        "EMAIL_TAKEN",
        `That email already has a PrepHub account that isn't a teacher's — often a student account made with the same school address. Email ${SCHOOLS_CONTACT_EMAIL} to have it converted to a teacher account.`,
      );
    }
    const elsewhere = existing.teacherAssignments.find((a) => a.schoolId !== school.id && a.removedAt === null);
    if (elsewhere) throw new TeacherError("EMAIL_TAKEN", "That teacher is already set up at another school.");

    const here = existing.teacherAssignments.find((a) => a.schoolId === school.id);
    if (here && here.removedAt === null) {
      throw new TeacherError("ALREADY_TEACHER", `${existing.firstName} is already a teacher here.`);
    }
    if (here?.removedAt) {
      const [, reopened] = await prisma.$transaction([
        prisma.teacherAssignment.update({
          where: { userId_schoolId: { userId: existing.id, schoolId: school.id } },
          data: { removedAt: null },
        }),
        prisma.classroom.updateMany({
          where: { teacherId: existing.id, schoolId: school.id, archivedAt: here.removedAt },
          data: { archivedAt: null },
        }),
      ]);
      return { userId: existing.id, created: false, restoredClasses: reopened.count };
    }
    await prisma.teacherAssignment.upsert({
      where: { userId_schoolId: { userId: existing.id, schoolId: school.id } },
      update: { removedAt: null },
      create: { userId: existing.id, schoolId: school.id },
    });
    return { userId: existing.id, created: false, restoredClasses: 0 };
  }

  const user = await prisma.user.create({
    data: {
      role: "TEACHER",
      firstName,
      email,
      ageConfirmed: true,
      teacherAssignments: { create: { schoolId: school.id } },
    },
    select: { id: true, email: true, firstName: true },
  });
  await sendInvite(user, school.officialName, input.invitedBy);
  return { userId: user.id, created: true, restoredClasses: 0 };
}

/** Sends a fresh set-password link to a teacher who hasn't signed in yet. */
export async function resendTeacherInvite(userId: string, schoolId: string, invitedBy: string): Promise<void> {
  const assignment = await prisma.teacherAssignment.findUnique({
    where: { userId_schoolId: { userId, schoolId } },
    select: {
      removedAt: true,
      school: { select: { officialName: true } },
      user: { select: { id: true, email: true, firstName: true, role: true } },
    },
  });
  if (!assignment || assignment.removedAt || assignment.user.role !== "TEACHER") {
    throw new TeacherError("NOT_FOUND", "Teacher not found.");
  }
  await sendInvite(assignment.user, assignment.school.officialName, invitedBy);
}

/**
 * Ends a teacher's access at a school and closes their classes there.
 * Nothing is deleted: the classes, the assignments and every student's work
 * stay. Both writes carry the same instant, which is how adding the teacher
 * back (inviteTeacher) knows which classes this closed and reopens them.
 */
export async function removeTeacher(userId: string, schoolId: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.teacherAssignment.updateMany({ where: { userId, schoolId, removedAt: null }, data: { removedAt: now } }),
    prisma.classroom.updateMany({ where: { teacherId: userId, schoolId, archivedAt: null }, data: { archivedAt: now } }),
  ]);
}

export type TeacherRow = {
  userId: string;
  firstName: string;
  email: string;
  addedAt: Date;
  /** Has a password or a linked Google account — i.e. could have signed in. */
  activated: boolean;
  classCount: number;
  studentCount: number;
};

/**
 * A school's teachers, for its Administrator and the Owner. Counts only —
 * an Administrator sees how many classes and students a teacher has, never
 * anyone's homework results (the same aggregate-only line as the rest of the
 * admin area).
 */
export async function listTeachers(schoolId: string): Promise<TeacherRow[]> {
  const rows = await prisma.teacherAssignment.findMany({
    where: { schoolId, removedAt: null, user: { role: "TEACHER", deletedAt: null } },
    orderBy: { user: { firstName: "asc" } },
    select: {
      createdAt: true,
      user: {
        select: {
          id: true,
          firstName: true,
          email: true,
          passwordHash: true,
          _count: { select: { accounts: true, classroomsTaught: { where: { schoolId, archivedAt: null } } } },
        },
      },
    },
  });
  if (rows.length === 0) return [];

  // Distinct students per teacher: a student in two of one teacher's classes
  // is one student, not two. One read of the school's open rosters.
  const enrollments = await prisma.classroomEnrollment.findMany({
    where: {
      removedAt: null,
      classroom: { schoolId, archivedAt: null, teacherId: { in: rows.map((r) => r.user.id) } },
    },
    select: { studentId: true, classroom: { select: { teacherId: true } } },
  });
  const students = new Map<string, Set<string>>();
  for (const e of enrollments) {
    const set = students.get(e.classroom.teacherId) ?? new Set<string>();
    set.add(e.studentId);
    students.set(e.classroom.teacherId, set);
  }

  return rows.map((r) => ({
    userId: r.user.id,
    firstName: r.user.firstName,
    email: r.user.email,
    addedAt: r.createdAt,
    activated: Boolean(r.user.passwordHash) || r.user._count.accounts > 0,
    classCount: r.user._count.classroomsTaught,
    studentCount: students.get(r.user.id)?.size ?? 0,
  }));
}
