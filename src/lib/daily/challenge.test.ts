import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { answerDailyChallenge, dayKey } from "./challenge";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyChallenge: { findUnique: vi.fn() },
    dailyChallengeAttempt: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/analytics/track", () => ({ FUNNEL_EVENTS: { DAILY_CHALLENGE_ANSWERED: "daily_challenge_answered" }, track: vi.fn() }));

const mocked = prisma as unknown as {
  dailyChallenge: Record<string, ReturnType<typeof vi.fn>>;
  dailyChallengeAttempt: Record<string, ReturnType<typeof vi.fn>>;
};

describe("dayKey", () => {
  it("is the UTC calendar day", () => {
    expect(dayKey(new Date("2026-09-21T23:59:59Z"))).toBe("2026-09-21");
    expect(dayKey(new Date("2026-09-22T00:00:01Z"))).toBe("2026-09-22");
  });
});

// The streak's day counting is `streakFromDays`, shared with the dashboard
// and tested in lib/dashboard/study-streak.test.ts.

describe("answerDailyChallenge", () => {
  const challenge = {
    id: "c1",
    day: "2026-09-21",
    question: { questionType: "MULTIPLE_CHOICE" },
    questionRevision: { answerChoices: [{ id: "right", isCorrect: true }, { id: "wrong", isCorrect: false }], acceptedAnswers: [] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    mocked.dailyChallenge.findUnique.mockResolvedValue(challenge);
    mocked.dailyChallengeAttempt.findUnique.mockResolvedValue(null);
    mocked.dailyChallengeAttempt.create.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("grades and records an answer to today's question", async () => {
    vi.setSystemTime(new Date("2026-09-21T18:00:00Z"));

    await expect(answerDailyChallenge("s1", "c1", "right")).resolves.toEqual({ ok: true, isCorrect: true });
    expect(mocked.dailyChallengeAttempt.create).toHaveBeenCalledWith({
      data: { challengeId: "c1", studentId: "s1", answer: "right", isCorrect: true },
    });
  });

  // Opened before midnight UTC, answered after: a result the page can put
  // into words, never a throw (which production would turn into a generic
  // error), and nothing recorded against yesterday's question.
  it("says the day rolled over when the question is yesterday's", async () => {
    vi.setSystemTime(new Date("2026-09-22T00:00:30Z"));

    await expect(answerDailyChallenge("s1", "c1", "right")).resolves.toEqual({ ok: false, reason: "rolled_over" });
    expect(mocked.dailyChallengeAttempt.create).not.toHaveBeenCalled();
  });

  it("returns the first answer on a second submit", async () => {
    vi.setSystemTime(new Date("2026-09-21T18:00:00Z"));
    mocked.dailyChallengeAttempt.findUnique.mockResolvedValue({ isCorrect: false });

    await expect(answerDailyChallenge("s1", "c1", "right")).resolves.toEqual({ ok: true, isCorrect: false });
    expect(mocked.dailyChallengeAttempt.create).not.toHaveBeenCalled();
  });
});
