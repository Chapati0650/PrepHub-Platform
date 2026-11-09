import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isDemoAccount } from "@/lib/demo-account";

/**
 * Who a random 1v1 Rush may pair with whom (2026-11-09).
 *
 * Random matching (live, and the recorded "race someone's run") used to draw
 * from every student in the database. A district trying the demo, an adult in
 * the staff "Student experience", or anyone on a demo login could then be
 * matched against a real student, a minor who would see the stranger's first
 * name, and the demo's own rule is that no real student ever meets a
 * fictional one. So the pool is split in two: real students only ever meet
 * real students, and "sandbox" accounts (demo logins, and every non-student
 * role) only each other, or the practice opponent once nobody turns up.
 * Joining by code or link is unchanged: that is someone choosing to play a
 * particular person.
 */
export function isSandboxAccount(user: { email: string | null; role: string }): boolean {
  return isDemoAccount(user.email) || user.role !== "STUDENT";
}

export async function isSandboxStudent(studentId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: studentId }, select: { email: true, role: true } });
  return !user || isSandboxAccount(user);
}

const SANDBOX_USER: Prisma.UserWhereInput = {
  OR: [
    { email: { endsWith: "@example.com", mode: "insensitive" } },
    { email: { endsWith: ".example.com", mode: "insensitive" } },
    { role: { not: "STUDENT" } },
  ],
};

/** A Prisma filter on a challenge's creator: the same side of the pool as the player. */
export function samePoolCreator(sandbox: boolean): Prisma.UserWhereInput {
  return sandbox ? SANDBOX_USER : { NOT: SANDBOX_USER };
}

/** The same condition for raw SQL over a `users` row aliased `alias`. */
export function samePoolSql(alias: string, sandbox: boolean): Prisma.Sql {
  const u = Prisma.raw(alias);
  const isSandbox = Prisma.sql`(LOWER(${u}."email") LIKE '%@example.com' OR LOWER(${u}."email") LIKE '%.example.com' OR ${u}."role" <> 'STUDENT')`;
  return sandbox ? isSandbox : Prisma.sql`NOT ${isSandbox}`;
}
