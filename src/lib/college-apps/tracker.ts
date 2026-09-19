import type { ApplicationItemKind, ApplicationPlan, ApplicationPlatform, ApplicationStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getDashboardData } from "@/lib/dashboard/dashboard-data";
import { getCollege, testPolicy, type College } from "@/lib/colleges/directory";
import { scoreFit, type ScoreFit } from "@/lib/colleges/score-fit";
import { admissionsCycle } from "./cycle";
import { FINANCIAL_AID_ITEMS, PLATFORM_PROMPTS } from "./platform-prompts";

// Student-side reads and writes for the College Apps tracker. Authorization
// (role + paid access) is the caller's job — the server actions in
// src/app/(app)/college-apps/actions.ts — and every function here scopes by
// studentId so a guessed id from another student's list returns nothing.

export class CollegeAppsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollegeAppsError";
  }
}

// ---- Onboarding ------------------------------------------------------------

export async function getProfile(studentId: string) {
  return prisma.collegeAppsProfile.findUnique({ where: { userId: studentId } });
}

// Creates the profile and seeds the student-level checklist: the shared
// essays for each chosen platform, plus FAFSA/CSS Profile for juniors and
// seniors. Idempotent — re-running onboarding updates grade/platforms and
// seeds only prompts for platforms that weren't seeded before, so a student
// who adds the UC app in October gets the PIQs without duplicating the
// Common App essay they already have.
export async function completeOnboarding(studentId: string, grade: 9 | 10 | 11 | 12, platforms: ApplicationPlatform[]) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.collegeAppsProfile.findUnique({ where: { userId: studentId } });
    const previous = new Set(existing?.platforms ?? []);
    await tx.collegeAppsProfile.upsert({
      where: { userId: studentId },
      create: { userId: studentId, grade, platforms },
      update: { grade, platforms },
    });

    const current = await tx.applicationItem.findMany({
      where: { studentId, applicationId: null },
      select: { title: true, position: true },
    });
    let position = current.reduce((m, i) => Math.max(m, i.position + 1), 0);
    const have = new Set(current.map((i) => i.title));

    for (const platform of platforms) {
      if (previous.has(platform)) continue;
      for (const p of PLATFORM_PROMPTS[platform].prompts) {
        if (have.has(p.title)) continue;
        await tx.applicationItem.create({
          data: { studentId, applicationId: null, kind: "PROMPT", source: "PLATFORM", title: p.title, detail: p.text, wordLimit: p.wordLimit, position: position++ },
        });
      }
    }
    if (grade >= 11 && !existing) {
      for (const f of FINANCIAL_AID_ITEMS) {
        if (have.has(f.title)) continue;
        await tx.applicationItem.create({
          data: { studentId, applicationId: null, kind: "FINANCIAL_AID", source: "PLATFORM", title: f.title, detail: f.detail, position: position++ },
        });
      }
    }
  });
}

// ---- Tracker reads ---------------------------------------------------------

export type TrackerApplication = {
  id: string;
  collegeId: number;
  collegeName: string;
  college: College | null;
  platform: ApplicationPlatform | null;
  plan: ApplicationPlan | null;
  deadline: Date | null;
  status: ApplicationStatus;
  fit: ScoreFit;
  itemCount: number;
  doneCount: number;
};

export type TrackerItem = {
  id: string;
  kind: ApplicationItemKind;
  source: "PLATFORM" | "CURATED" | "STUDENT";
  title: string;
  detail: string;
  wordLimit: number | null;
  done: boolean;
};

export type Tracker = {
  grade: 9 | 10 | 11 | 12;
  platforms: ApplicationPlatform[];
  studentRange: { min: number; max: number } | null;
  applications: TrackerApplication[];
  sharedItems: TrackerItem[];
  nextDeadline: { application: TrackerApplication; daysLeft: number } | null;
};

function toItem(i: { id: string; kind: ApplicationItemKind; source: "PLATFORM" | "CURATED" | "STUDENT"; title: string; detail: string; wordLimit: number | null; doneAt: Date | null }): TrackerItem {
  return { id: i.id, kind: i.kind, source: i.source, title: i.title, detail: i.detail, wordLimit: i.wordLimit, done: i.doneAt !== null };
}

function daysUntil(date: Date, now = new Date()): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.ceil((date.getTime() - now.getTime()) / day);
}

export async function getTracker(studentId: string): Promise<Tracker | null> {
  const profile = await prisma.collegeAppsProfile.findUnique({ where: { userId: studentId } });
  if (!profile) return null;

  const [apps, shared, dashboard] = await Promise.all([
    prisma.collegeApplication.findMany({
      where: { studentId },
      orderBy: [{ deadline: "asc" }, { collegeName: "asc" }],
      include: { items: { select: { doneAt: true } } },
    }),
    prisma.applicationItem.findMany({ where: { studentId, applicationId: null }, orderBy: { position: "asc" } }),
    getDashboardData(studentId),
  ]);

  const studentRange = dashboard.currentRange;
  const applications: TrackerApplication[] = apps.map((a) => {
    const college = getCollege(a.collegeId);
    return {
      id: a.id,
      collegeId: a.collegeId,
      collegeName: a.collegeName,
      college,
      platform: a.platform,
      plan: a.plan,
      deadline: a.deadline,
      status: a.status,
      fit: scoreFit(studentRange, college ?? { sat25: null, sat75: null }),
      itemCount: a.items.length,
      doneCount: a.items.filter((i) => i.doneAt).length,
    };
  });

  const now = new Date();
  const upcoming = applications
    .filter((a) => a.deadline && a.deadline >= now && a.status !== "SUBMITTED" && a.status !== "WITHDRAWN")
    .sort((a, b) => a.deadline!.getTime() - b.deadline!.getTime())[0];

  return {
    grade: profile.grade as 9 | 10 | 11 | 12,
    platforms: profile.platforms,
    studentRange,
    applications,
    sharedItems: shared.map(toItem),
    nextDeadline: upcoming ? { application: upcoming, daysLeft: daysUntil(upcoming.deadline!, now) } : null,
  };
}

export type ApplicationDetail = TrackerApplication & {
  notes: string;
  items: TrackerItem[];
  studentRange: { min: number; max: number } | null;
  testPolicy: ReturnType<typeof testPolicy>;
};

export async function getApplication(studentId: string, applicationId: string): Promise<ApplicationDetail | null> {
  const [app, dashboard] = await Promise.all([
    prisma.collegeApplication.findUnique({ where: { id: applicationId }, include: { items: { orderBy: { position: "asc" } } } }),
    getDashboardData(studentId),
  ]);
  if (!app || app.studentId !== studentId) return null;
  const college = getCollege(app.collegeId);
  return {
    id: app.id,
    collegeId: app.collegeId,
    collegeName: app.collegeName,
    college,
    platform: app.platform,
    plan: app.plan,
    deadline: app.deadline,
    status: app.status,
    notes: app.notes,
    fit: scoreFit(dashboard.currentRange, college ?? { sat25: null, sat75: null }),
    itemCount: app.items.length,
    doneCount: app.items.filter((i) => i.doneAt).length,
    items: app.items.map(toItem),
    studentRange: dashboard.currentRange,
    testPolicy: testPolicy(college ?? { testRequirements: null }),
  };
}

// ---- Tracker writes --------------------------------------------------------

// Adds a college and seeds its checklist: this cycle's curated supplements
// (copied, so the student's list is theirs from here on), "send test scores"
// when the college requires or recommends them, and the application fee.
export async function addCollege(studentId: string, collegeId: number): Promise<{ id: string }> {
  const college = getCollege(collegeId);
  if (!college) throw new CollegeAppsError("That college isn't in the directory.");
  const existing = await prisma.collegeApplication.findUnique({ where: { studentId_collegeId: { studentId, collegeId } }, select: { id: true } });
  if (existing) return existing;

  const supplements = await prisma.collegeSupplement.findMany({
    where: { collegeId, cycle: admissionsCycle() },
    orderBy: { position: "asc" },
  });
  const policy = testPolicy(college);
  let position = 0;
  const items = [
    ...supplements.map((s) => ({ kind: "PROMPT" as const, source: "CURATED" as const, title: s.title, detail: s.promptText, wordLimit: s.wordLimit, position: position++ })),
    ...(policy === "required" || policy === "recommended"
      ? [{ kind: "TEST_SCORES" as const, source: "PLATFORM" as const, title: "Send SAT scores", detail: `${college.name} ${policy === "required" ? "requires" : "recommends"} test scores. Send them from your College Board account.`, wordLimit: null, position: position++ }]
      : []),
    { kind: "FEE" as const, source: "PLATFORM" as const, title: "Application fee or fee waiver", detail: "", wordLimit: null, position: position++ },
  ];

  return prisma.collegeApplication.create({
    data: { studentId, collegeId, collegeName: college.name, items: { create: items.map((i) => ({ ...i, studentId })) } },
    select: { id: true },
  });
}

export async function removeCollege(studentId: string, applicationId: string): Promise<void> {
  await prisma.collegeApplication.deleteMany({ where: { id: applicationId, studentId } });
}

export type ApplicationPatch = {
  platform?: ApplicationPlatform | null;
  plan?: ApplicationPlan | null;
  deadline?: Date | null;
  status?: ApplicationStatus;
  notes?: string;
};

export async function updateApplication(studentId: string, applicationId: string, patch: ApplicationPatch): Promise<void> {
  const res = await prisma.collegeApplication.updateMany({ where: { id: applicationId, studentId }, data: patch });
  if (res.count === 0) throw new CollegeAppsError("Application not found.");
}

export async function setItemDone(studentId: string, itemId: string, done: boolean): Promise<void> {
  await prisma.applicationItem.updateMany({ where: { id: itemId, studentId }, data: { doneAt: done ? new Date() : null } });
}

export async function addItems(
  studentId: string,
  applicationId: string | null,
  items: { kind: ApplicationItemKind; title: string; detail?: string; wordLimit?: number | null }[],
): Promise<void> {
  if (applicationId) {
    const owned = await prisma.collegeApplication.findFirst({ where: { id: applicationId, studentId }, select: { id: true } });
    if (!owned) throw new CollegeAppsError("Application not found.");
  }
  const last = await prisma.applicationItem.aggregate({ where: { studentId, applicationId }, _max: { position: true } });
  let position = (last._max.position ?? -1) + 1;
  await prisma.applicationItem.createMany({
    data: items
      .filter((i) => i.title.trim())
      .map((i) => ({
        studentId,
        applicationId,
        kind: i.kind,
        source: "STUDENT" as const,
        title: i.title.trim().slice(0, 200),
        detail: (i.detail ?? "").trim().slice(0, 4000),
        wordLimit: i.wordLimit ?? null,
        position: position++,
      })),
  });
}

export async function deleteItem(studentId: string, itemId: string): Promise<void> {
  await prisma.applicationItem.deleteMany({ where: { id: itemId, studentId } });
}
