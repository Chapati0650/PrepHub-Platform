import { prisma } from "@/lib/prisma";
import { moveItem, nextPosition } from "@/lib/curriculum/ordering";
import { getCollege } from "@/lib/colleges/directory";
import { CollegeAppsError } from "./tracker";

// Owner-only: the yearly curation of each college's supplemental prompts.
// Authorization is the caller's job (requireOwner in the CMS actions).
// Rows are per (college, cycle); students receive *copies* when they add
// the college, so editing here never rewrites a student's checklist.

export async function listSupplements(collegeId: number, cycle: number) {
  return prisma.collegeSupplement.findMany({ where: { collegeId, cycle }, orderBy: { position: "asc" } });
}

// Every college with at least one supplement in the cycle — the CMS
// landing list, so the Owner can see coverage at a glance.
export async function listCuratedColleges(cycle: number) {
  const rows = await prisma.collegeSupplement.groupBy({ by: ["collegeId"], where: { cycle }, _count: { _all: true } });
  return rows
    .map((r) => ({ collegeId: r.collegeId, name: getCollege(r.collegeId)?.name ?? `#${r.collegeId}`, count: r._count._all }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createSupplement(collegeId: number, cycle: number, input: { title: string; promptText: string; wordLimit: number | null }) {
  if (!getCollege(collegeId)) throw new CollegeAppsError("That college isn't in the directory.");
  const title = input.title.trim();
  const promptText = input.promptText.trim();
  if (!title || !promptText) throw new CollegeAppsError("A title and the prompt text are both required.");
  const siblings = await prisma.collegeSupplement.findMany({ where: { collegeId, cycle }, select: { id: true, position: true } });
  return prisma.collegeSupplement.create({
    data: { collegeId, cycle, title: title.slice(0, 200), promptText: promptText.slice(0, 4000), wordLimit: input.wordLimit, position: nextPosition(siblings) },
  });
}

export async function updateSupplement(id: string, input: { title: string; promptText: string; wordLimit: number | null }) {
  const title = input.title.trim();
  const promptText = input.promptText.trim();
  if (!title || !promptText) throw new CollegeAppsError("A title and the prompt text are both required.");
  return prisma.collegeSupplement.update({ where: { id }, data: { title: title.slice(0, 200), promptText: promptText.slice(0, 4000), wordLimit: input.wordLimit } });
}

export async function moveSupplement(id: string, direction: "up" | "down") {
  const row = await prisma.collegeSupplement.findUnique({ where: { id }, select: { collegeId: true, cycle: true } });
  if (!row) return;
  const siblings = await prisma.collegeSupplement.findMany({ where: { collegeId: row.collegeId, cycle: row.cycle }, select: { id: true, position: true } });
  const next = moveItem(siblings, id, direction);
  await prisma.$transaction(next.map((s) => prisma.collegeSupplement.update({ where: { id: s.id }, data: { position: s.position } })));
}

export async function deleteSupplement(id: string) {
  await prisma.collegeSupplement.delete({ where: { id } });
}

// Copies last cycle's prompts forward as a starting point for this year's
// curation — most colleges change little year to year, and retyping 8
// prompts for 60 schools each August is the cost that would kill the habit.
export async function copySupplementsFromPreviousCycle(collegeId: number, cycle: number): Promise<number> {
  const [current, previous] = await Promise.all([
    prisma.collegeSupplement.count({ where: { collegeId, cycle } }),
    prisma.collegeSupplement.findMany({ where: { collegeId, cycle: cycle - 1 }, orderBy: { position: "asc" } }),
  ]);
  if (current > 0 || previous.length === 0) return 0;
  await prisma.collegeSupplement.createMany({
    data: previous.map((p) => ({ collegeId, cycle, title: p.title, promptText: p.promptText, wordLimit: p.wordLimit, position: p.position })),
  });
  return previous.length;
}
