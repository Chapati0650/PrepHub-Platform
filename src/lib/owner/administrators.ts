import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { OwnerError } from "./errors";

export type CreateAdministratorInput = {
  firstName: string;
  email: string;
  password: string;
  organizationId: string;
  scope: "SCHOOL" | "DISTRICT";
};

// PRD-017 §7.1/7.2: every administrator gets a separate account; only the
// Owner can create one, and only the Owner assigns it to an organization —
// there's no administrator self-registration or invitation flow in V1.
export async function createAdministrator(input: CreateAdministratorInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new OwnerError("EMAIL_TAKEN", "An account with this email already exists.");
  }

  const passwordHash = await hashPassword(input.password);

  return prisma.user.create({
    data: {
      role: "SCHOOL_ADMINISTRATOR",
      firstName: input.firstName,
      email: input.email,
      passwordHash,
      ageConfirmed: true,
      adminAssignments: {
        create: [{ organizationId: input.organizationId, scope: input.scope }],
      },
    },
  });
}

// PRD-017 §7.3: an administrator may be assigned to multiple organizations.
export async function assignAdministrator(
  userId: string,
  organizationId: string,
  scope: "SCHOOL" | "DISTRICT",
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "SCHOOL_ADMINISTRATOR") {
    throw new OwnerError("ADMINISTRATOR_NOT_FOUND", "Administrator account not found.");
  }

  return prisma.administratorAssignment.upsert({
    where: { userId_organizationId: { userId, organizationId } },
    update: { removedAt: null, scope },
    create: { userId, organizationId, scope },
  });
}

// PRD-017 §7.4: ends access to that org immediately; preserves the account
// and doesn't touch other assignments.
export async function removeAdministratorAssignment(assignmentId: string) {
  const assignment = await prisma.administratorAssignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment) {
    throw new OwnerError("ADMINISTRATOR_NOT_FOUND", "Administrator assignment not found.");
  }
  return prisma.administratorAssignment.update({
    where: { id: assignmentId },
    data: { removedAt: new Date() },
  });
}
