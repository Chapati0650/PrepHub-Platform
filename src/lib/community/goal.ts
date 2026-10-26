import type { CommunityGoalMetric } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { endOfLocalDay } from "./local-day";

/**
 * The School Community goal, with a prize and a deadline (2026-10-24).
 *
 * PRD-009 §7's goal was a single all-time number. A goal a school can *win*
 * needs two more things: a window, so "answer 5,000 questions" means from
 * today rather than counting work done before anyone knew about it, and a
 * prize, so the number is worth chasing. Both are optional, and a goal set
 * before this existed (no `communityGoalStartsAt`) keeps counting all-time
 * exactly as it did.
 *
 * Still aggregate-only: progress is a school total, and nothing here can
 * name a student.
 */

export {
  GOAL_TIME_ZONE,
  endOfLocalDay,
  startOfLocalDay,
  localDateInputValue,
  formatGoalDate,
  formatLongLocalDate,
} from "./local-day";

export const GOAL_LABELS: Record<CommunityGoalMetric, string> = {
  QUESTIONS_ANSWERED: "Questions Answered",
  STUDY_HOURS: "Study Hours",
  ADAPTIVE_SESSIONS: "Practice Sets",
};

/** The longest prize text a school can set — one line on a phone. */
export const GOAL_PRIZE_MAX_LENGTH = 120;

/**
 * The largest target a goal can have. The column is a 32-bit integer, so a
 * mistyped "50000000000" used to fail as a database error; ten million is
 * far beyond anything one school will count, and says so in words instead.
 */
export const GOAL_TARGET_MAX = 10_000_000;

export type GoalState = "IN_PROGRESS" | "REACHED" | "ENDED";

export type GoalStatus = {
  state: GoalState;
  /** 0–100, for the bar. */
  percent: number;
  remaining: number;
  /** Whole calendar days left until the deadline, counting today; null without one. */
  daysLeft: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where a goal stands. Pure, so every branch is tested directly.
 *
 * Reached is sticky: once `reachedAt` is recorded the goal stays won, even
 * after its deadline, and even if the student list later shrinks enough to
 * lower the total. A school that won a pizza party doesn't lose it in January.
 */
export function goalStatus({
  current,
  target,
  endsAt,
  reachedAt,
  now,
}: {
  current: number;
  target: number;
  endsAt: Date | null;
  reachedAt: Date | null;
  now: Date;
}): GoalStatus {
  const percent = target > 0 ? Math.min(100, Math.floor((current / target) * 100)) : 0;
  const remaining = Math.max(0, target - current);
  if (reachedAt || (target > 0 && current >= target)) {
    return { state: "REACHED", percent: 100, remaining: 0, daysLeft: null };
  }
  if (endsAt && now.getTime() > endsAt.getTime()) {
    return { state: "ENDED", percent, remaining, daysLeft: null };
  }
  return {
    state: "IN_PROGRESS",
    percent,
    remaining,
    daysLeft: endsAt ? Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS)) : null,
  };
}

export class GoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalError";
  }
}

export type SaveGoalInput = {
  metric: CommunityGoalMetric | null;
  target: number | null;
  prize: string | null;
  endsAt: Date | null;
};

/**
 * Sets, changes or clears a school's goal. Used by the Owner's school page
 * and by the school's own Administrator; each caller checks who may edit
 * which school before calling.
 *
 * Changing *what* is being counted (the metric or the target) starts a new
 * goal: the count restarts from now and any earlier win is cleared, because
 * "5,000 questions" and "50 study hours" are different races. Changing only
 * the prize or the deadline keeps the race going — an Administrator
 * extending a deadline by a week must not wipe out a month of progress.
 */
export async function saveCommunityGoal(schoolId: string, input: SaveGoalInput, now: Date = new Date()) {
  const org = await prisma.organization.findUnique({ where: { id: schoolId } });
  if (!org) throw new GoalError("School not found.");
  if (org.organizationType !== "SCHOOL") throw new GoalError("Only schools can have a community goal.");

  if (!input.metric) {
    return prisma.organization.update({
      where: { id: schoolId },
      data: {
        communityGoalMetric: null,
        communityGoalTarget: null,
        communityGoalPrize: null,
        communityGoalStartsAt: null,
        communityGoalEndsAt: null,
        communityGoalReachedAt: null,
      },
    });
  }

  if (!input.target || !Number.isInteger(input.target) || input.target <= 0) {
    throw new GoalError("Enter a goal target greater than zero.");
  }
  if (input.target > GOAL_TARGET_MAX) throw new GoalError(targetTooLargeMessage());
  const prize = input.prize?.trim() || null;
  if (prize && prize.length > GOAL_PRIZE_MAX_LENGTH) {
    throw new GoalError(`Keep the prize under ${GOAL_PRIZE_MAX_LENGTH} characters.`);
  }

  const newRace = org.communityGoalMetric !== input.metric || org.communityGoalTarget !== input.target;
  const deadlineChanged = (org.communityGoalEndsAt?.getTime() ?? null) !== (input.endsAt?.getTime() ?? null);
  // A deadline that has already passed is refused whenever this save starts
  // a race, not only when the date itself was edited. The editor fills the
  // date in with the last goal's deadline, so changing only the target after
  // that day had gone by used to save a brand-new goal that was already
  // "Ended" while the screen said "Saved". Keeping an old, passed deadline is
  // still fine when the race carries on — changing a finished goal's prize
  // doesn't reopen it.
  if (input.endsAt && input.endsAt.getTime() <= now.getTime() && (deadlineChanged || newRace)) {
    throw new GoalError(
      deadlineChanged
        ? "Pick a deadline that hasn't passed yet."
        : "The deadline on this goal has already passed. Pick a new date for the new goal, or clear it for no deadline.",
    );
  }

  return prisma.organization.update({
    where: { id: schoolId },
    data: {
      communityGoalMetric: input.metric,
      communityGoalTarget: input.target,
      communityGoalPrize: prize,
      communityGoalEndsAt: input.endsAt,
      ...(newRace ? { communityGoalStartsAt: now, communityGoalReachedAt: null } : {}),
    },
  });
}

function targetTooLargeMessage(): string {
  return `Keep the target at ${GOAL_TARGET_MAX.toLocaleString("en-US")} or less.`;
}

/**
 * Parses the editor's form fields. Shared by both callers so the Owner and an
 * Administrator can never be held to different rules.
 */
export function parseGoalForm(formData: FormData): SaveGoalInput | { error: string } {
  const rawMetric = formData.get("communityGoalMetric");
  const metric =
    rawMetric === "QUESTIONS_ANSWERED" || rawMetric === "STUDY_HOURS" || rawMetric === "ADAPTIVE_SESSIONS"
      ? rawMetric
      : null;
  if (rawMetric && !metric) return { error: "Choose what the goal counts." };

  const rawTarget = String(formData.get("communityGoalTarget") ?? "").trim();
  const target = rawTarget ? Number(rawTarget) : null;
  if (metric && (!target || !Number.isInteger(target) || target <= 0)) {
    return { error: "Enter a goal target greater than zero." };
  }
  if (metric && target && target > GOAL_TARGET_MAX) return { error: targetTooLargeMessage() };

  const prize = String(formData.get("communityGoalPrize") ?? "").trim() || null;
  const rawEnds = String(formData.get("communityGoalEndsAt") ?? "").trim();
  const endsAt = rawEnds ? endOfLocalDay(rawEnds) : null;
  if (rawEnds && !endsAt) return { error: "Enter the deadline as a date." };

  return { metric, target: metric ? target : null, prize: metric ? prize : null, endsAt: metric ? endsAt : null };
}
