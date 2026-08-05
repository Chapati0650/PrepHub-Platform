import { prisma } from "@/lib/prisma";

export type DirectoryResult = {
  id: string;
  name: string;
  type: "SCHOOL" | "DISTRICT";
  available: boolean;
};

const BROWSE_LIMIT = 50;
const SEARCH_LIMIT = 25;

/**
 * PRD-002 §6: browse (no query) or live prefix-search the school/district
 * directory. Purely informational — never grants access on its own.
 */
export async function searchOrganizations(rawQuery: string): Promise<DirectoryResult[]> {
  const query = rawQuery.trim();

  const orgs = await prisma.organization.findMany({
    where: {
      directoryVisible: true,
      ...(query
        ? { officialName: { startsWith: query, mode: "insensitive" } }
        : {}),
    },
    select: { id: true, officialName: true, organizationType: true, status: true },
    orderBy: [{ officialName: "asc" }],
    take: query ? SEARCH_LIMIT : BROWSE_LIMIT,
  });

  // §6.3: default browse list prioritizes organizations currently providing PrepHub.
  const sorted = query
    ? orgs
    : [...orgs].sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE"));

  return sorted.map((org) => ({
    id: org.id,
    name: org.officialName,
    type: org.organizationType,
    available: org.status === "ACTIVE",
  }));
}
