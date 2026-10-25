import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import { TeacherError } from "./errors";

/**
 * Who a teacher is and where they teach, resolved on the server for every
 * teacher page and action (CLAUDE.md: all authorization is server-side).
 *
 * A teacher's access is their active `TeacherAssignment`, not their role
 * alone: an Administrator removing a teacher sets `removedAt`, and from that
 * request on, every guard here refuses them — their classes stay, but they
 * can no longer open them.
 */
export type TeacherContext = {
  userId: string;
  firstName: string;
  schoolId: string;
  schoolName: string;
};

export async function getTeacherContext(userId: string): Promise<TeacherContext | null> {
  const assignment = await prisma.teacherAssignment.findFirst({
    where: { userId, removedAt: null, user: { role: "TEACHER", deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: {
      schoolId: true,
      school: { select: { officialName: true } },
      user: { select: { firstName: true } },
    },
  });
  if (!assignment) return null;
  return {
    userId,
    firstName: assignment.user.firstName,
    schoolId: assignment.schoolId,
    schoolName: assignment.school.officialName,
  };
}

/** The signed-in teacher's id, or a redirect. Doesn't require an active assignment. */
export async function requireTeacherSession(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "TEACHER") {
    logUnauthorizedAccess("Non-teacher attempted a teacher-only page", {
      accountId: session.user.id,
      role: session.user.role,
    });
    redirect("/home");
  }
  return session.user.id;
}

/**
 * For teacher pages. A teacher whose access has ended is sent to /teacher,
 * which explains it (and is the one page that doesn't call this).
 */
export async function requireTeacher(): Promise<TeacherContext> {
  const userId = await requireTeacherSession();
  const context = await getTeacherContext(userId);
  if (!context) redirect("/teacher");
  return context;
}

/** For teacher server actions: throws rather than redirecting. */
export async function requireTeacherAction(): Promise<TeacherContext> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "TEACHER") {
    logUnauthorizedAccess("Non-teacher attempted a teacher action", {
      accountId: session?.user?.id,
      role: session?.user?.role,
    });
    throw new Error("Not authorized.");
  }
  const context = await getTeacherContext(session.user.id);
  if (!context) throw new Error("Your teaching access has ended.");
  return context;
}

/**
 * A class this teacher owns, at the school they teach at — or a logged
 * refusal. A guessed id from another teacher's class is a privilege-boundary
 * attempt (GER §2), so it is logged, and it reads as "not found" either way.
 */
export async function requireOwnedClassroom(context: TeacherContext, classroomId: string) {
  const classroom = await prisma.classroom.findUnique({ where: { id: classroomId } });
  if (!classroom || classroom.teacherId !== context.userId || classroom.schoolId !== context.schoolId) {
    if (classroom) {
      logUnauthorizedAccess("Teacher attempted to access another teacher's class", {
        accountId: context.userId,
        affectedResourceId: classroomId,
      });
    }
    throw new TeacherError("NOT_FOUND", "Class not found.");
  }
  return classroom;
}

/** An assignment in one of this teacher's classes, or a logged refusal. */
export async function requireOwnedAssignment(context: TeacherContext, assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { classroom: true },
  });
  if (
    !assignment ||
    assignment.classroom.teacherId !== context.userId ||
    assignment.classroom.schoolId !== context.schoolId
  ) {
    if (assignment) {
      logUnauthorizedAccess("Teacher attempted to access another teacher's assignment", {
        accountId: context.userId,
        affectedResourceId: assignmentId,
      });
    }
    throw new TeacherError("NOT_FOUND", "Assignment not found.");
  }
  return assignment;
}
