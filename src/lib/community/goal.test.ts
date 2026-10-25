import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  endOfLocalDay,
  formatGoalDate,
  goalStatus,
  localDateInputValue,
  parseGoalForm,
  saveCommunityGoal,
} from "@/lib/community/goal";

vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findUnique: vi.fn(), update: vi.fn() } },
}));

const mocked = prisma as unknown as { organization: Record<string, ReturnType<typeof vi.fn>> };

const NOW = new Date("2026-11-10T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("goalStatus", () => {
  it("is in progress with the days left, counting today", () => {
    expect(
      goalStatus({ current: 250, target: 1000, endsAt: new Date(NOW.getTime() + 2.5 * DAY), reachedAt: null, now: NOW }),
    ).toEqual({ state: "IN_PROGRESS", percent: 25, remaining: 750, daysLeft: 3 });
  });

  it("has no day count without a deadline", () => {
    expect(goalStatus({ current: 0, target: 10, endsAt: null, reachedAt: null, now: NOW }).daysLeft).toBeNull();
  });

  it("never rounds a goal up to 100% before it's actually reached", () => {
    expect(goalStatus({ current: 999, target: 1000, endsAt: null, reachedAt: null, now: NOW })).toMatchObject({
      state: "IN_PROGRESS",
      percent: 99,
      remaining: 1,
    });
  });

  it("is reached the moment the count meets the target", () => {
    expect(goalStatus({ current: 1000, target: 1000, endsAt: null, reachedAt: null, now: NOW })).toEqual({
      state: "REACHED",
      percent: 100,
      remaining: 0,
      daysLeft: null,
    });
  });

  it("stays reached once recorded, even past the deadline and below the target", () => {
    expect(
      goalStatus({ current: 400, target: 1000, endsAt: new Date(NOW.getTime() - DAY), reachedAt: new Date(NOW.getTime() - 3 * DAY), now: NOW })
        .state,
    ).toBe("REACHED");
  });

  it("ends short when the deadline passes first", () => {
    expect(goalStatus({ current: 400, target: 1000, endsAt: new Date(NOW.getTime() - 1), reachedAt: null, now: NOW })).toEqual({
      state: "ENDED",
      percent: 40,
      remaining: 600,
      daysLeft: null,
    });
  });
});

describe("deadline dates", () => {
  it("ends a day at midnight in Texas, not in UTC — in standard time", () => {
    // CST is UTC-6: 23:59:59.999 on Dec 15 is 05:59:59.999 on Dec 16, UTC.
    expect(endOfLocalDay("2026-12-15")?.toISOString()).toBe("2026-12-16T05:59:59.999Z");
  });

  it("…and in daylight time", () => {
    // CDT is UTC-5.
    expect(endOfLocalDay("2026-10-30")?.toISOString()).toBe("2026-10-31T04:59:59.999Z");
  });

  it("rejects something that isn't a real date", () => {
    expect(endOfLocalDay("2026-02-30")).toBeNull();
    expect(endOfLocalDay("next friday")).toBeNull();
  });

  it("round-trips back to the date the Owner typed", () => {
    const end = endOfLocalDay("2026-12-15")!;
    expect(localDateInputValue(end)).toBe("2026-12-15");
    expect(formatGoalDate(end)).toBe("Dec 15");
  });
});

describe("parseGoalForm", () => {
  function form(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it("reads a full goal", () => {
    expect(
      parseGoalForm(
        form({ communityGoalMetric: "STUDY_HOURS", communityGoalTarget: "500", communityGoalPrize: "  Pizza party ", communityGoalEndsAt: "2026-12-15" }),
      ),
    ).toEqual({ metric: "STUDY_HOURS", target: 500, prize: "Pizza party", endsAt: endOfLocalDay("2026-12-15") });
  });

  it("clears everything when no metric is chosen", () => {
    expect(parseGoalForm(form({ communityGoalMetric: "", communityGoalTarget: "500", communityGoalPrize: "x" }))).toEqual({
      metric: null,
      target: null,
      prize: null,
      endsAt: null,
    });
  });

  it("refuses a goal without a positive whole target", () => {
    expect(parseGoalForm(form({ communityGoalMetric: "STUDY_HOURS", communityGoalTarget: "0" }))).toHaveProperty("error");
    expect(parseGoalForm(form({ communityGoalMetric: "STUDY_HOURS", communityGoalTarget: "2.5" }))).toHaveProperty("error");
  });

  it("refuses an unknown metric rather than silently clearing the goal", () => {
    expect(parseGoalForm(form({ communityGoalMetric: "VIBES", communityGoalTarget: "5" }))).toHaveProperty("error");
  });
});

describe("saveCommunityGoal", () => {
  const school = {
    id: "school1",
    organizationType: "SCHOOL",
    communityGoalMetric: "QUESTIONS_ANSWERED",
    communityGoalTarget: 5000,
    communityGoalEndsAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.organization.update.mockResolvedValue({});
  });

  it("starts a new race when what's counted changes — the count restarts and an old win is cleared", async () => {
    mocked.organization.findUnique.mockResolvedValue(school);

    await saveCommunityGoal("school1", { metric: "QUESTIONS_ANSWERED", target: 8000, prize: "Pizza", endsAt: null }, NOW);

    expect(mocked.organization.update.mock.calls[0][0].data).toMatchObject({
      communityGoalTarget: 8000,
      communityGoalStartsAt: NOW,
      communityGoalReachedAt: null,
    });
  });

  it("keeps the race going when only the prize or the deadline changes", async () => {
    mocked.organization.findUnique.mockResolvedValue(school);

    await saveCommunityGoal(
      "school1",
      { metric: "QUESTIONS_ANSWERED", target: 5000, prize: "Pizza and a DJ", endsAt: new Date(NOW.getTime() + 7 * DAY) },
      NOW,
    );

    const data = mocked.organization.update.mock.calls[0][0].data;
    expect(data.communityGoalPrize).toBe("Pizza and a DJ");
    expect(data).not.toHaveProperty("communityGoalStartsAt");
    expect(data).not.toHaveProperty("communityGoalReachedAt");
  });

  it("refuses a deadline that has already passed", async () => {
    mocked.organization.findUnique.mockResolvedValue(school);
    await expect(
      saveCommunityGoal("school1", { metric: "QUESTIONS_ANSWERED", target: 5000, prize: null, endsAt: new Date(NOW.getTime() - DAY) }, NOW),
    ).rejects.toThrow("hasn't passed");
  });

  it("only applies to schools", async () => {
    mocked.organization.findUnique.mockResolvedValue({ ...school, organizationType: "DISTRICT" });
    await expect(
      saveCommunityGoal("school1", { metric: "QUESTIONS_ANSWERED", target: 5000, prize: null, endsAt: null }, NOW),
    ).rejects.toThrow("Only schools");
    expect(mocked.organization.update).not.toHaveBeenCalled();
  });

  it("clears every goal field together", async () => {
    mocked.organization.findUnique.mockResolvedValue(school);
    await saveCommunityGoal("school1", { metric: null, target: null, prize: null, endsAt: null }, NOW);
    expect(mocked.organization.update.mock.calls[0][0].data).toEqual({
      communityGoalMetric: null,
      communityGoalTarget: null,
      communityGoalPrize: null,
      communityGoalStartsAt: null,
      communityGoalEndsAt: null,
      communityGoalReachedAt: null,
    });
  });
});
