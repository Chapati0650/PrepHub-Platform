import type { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { hasActiveIndividualSubscription, hasActiveSchoolEntitlement } from "@/lib/entitlements";

export type UserAccessType = "SCHOOL_ADMIN" | "INDIVIDUAL" | "SCHOOL" | "NONE";

export type UserDirectoryEntry = {
  id: string;
  firstName: string;
  email: string;
  role: Role;
  createdAt: Date;
  accessType: UserAccessType;
};

export type UserDirectoryStats = {
  totalUsers: number;
  totalStudents: number;
  premiumUsers: number;
  individualPremium: number;
  schoolPremium: number;
};

export type UserDirectoryData = {
  entries: UserDirectoryEntry[];
  stats: UserDirectoryStats;
};

// Owner-only, platform-wide "every account" view — nothing like it existed
// before (Owner's other list pages are all school-scoped). Premium status
// reuses hasActiveIndividualSubscription/hasActiveSchoolEntitlement directly
// from src/lib/entitlements.ts, the one place PRD-017 §12 allows that rule
// to live, applied in-memory over a single batched query rather than calling
// hasPaidAccess per user (which would be one extra Prisma round trip per row
// for a page that's meant to show every user at once).
export async function getUserDirectory(): Promise<UserDirectoryData> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      firstName: true,
      email: true,
      role: true,
      createdAt: true,
      subscription: true,
      studentMembership: { include: { organization: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const entries: UserDirectoryEntry[] = users.map((user) => {
    let accessType: UserAccessType = "NONE";
    if (user.role === "SCHOOL_ADMINISTRATOR") {
      // PRD-011 §7: unconditional access for evaluation, not a paid entitlement.
      accessType = "SCHOOL_ADMIN";
    } else if (hasActiveIndividualSubscription(user.subscription)) {
      accessType = "INDIVIDUAL";
    } else if (hasActiveSchoolEntitlement(user.studentMembership)) {
      accessType = "SCHOOL";
    }

    return {
      id: user.id,
      firstName: user.firstName,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      accessType,
    };
  });

  const individualPremium = entries.filter((e) => e.accessType === "INDIVIDUAL").length;
  const schoolPremium = entries.filter((e) => e.accessType === "SCHOOL").length;

  return {
    entries,
    stats: {
      totalUsers: entries.length,
      totalStudents: entries.filter((e) => e.role === "STUDENT").length,
      premiumUsers: individualPremium + schoolPremium,
      individualPremium,
      schoolPremium,
    },
  };
}
