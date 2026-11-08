import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimBotOpponent, tickLive } from "@/lib/rush/live";
import { RUSH_BOT_AFTER_MS } from "@/lib/rush/config";
import { parseBotProfile } from "@/lib/rush/bot";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mock = {
    rushChallenge: { findUnique: vi.fn(), updateMany: vi.fn() },
    rushSlot: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    categoryState: { findMany: vi.fn() },
  };
  return { prisma: mock };
});

const db = prisma as unknown as {
  rushChallenge: Record<string, ReturnType<typeof vi.fn>>;
  rushSlot: Record<string, ReturnType<typeof vi.fn>>;
  user: Record<string, ReturnType<typeof vi.fn>>;
  categoryState: Record<string, ReturnType<typeof vi.fn>>;
};

function room(over: Record<string, unknown>) {
  return {
    id: "c1",
    live: true,
    mode: "RANDOM",
    liveStatus: "WAITING",
    liveStartsAt: null,
    livePosition: 0,
    livePositionStartedAt: null,
    invitedStudentId: null,
    creatorId: "me",
    createdAt: new Date(Date.now() - 1_000),
    scoringVersion: 2,
    bot: null,
    set: { section: "READING_WRITING", _count: { slots: 3 } },
    runs: [{ id: "r1", studentId: "me", answers: [] }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.rushSlot.findMany.mockResolvedValue([
    { question: { category: "GRAMMAR", difficulty: "EASY" } },
    { question: { category: "GRAMMAR", difficulty: "MEDIUM" } },
    { question: { category: "VOCABULARY", difficulty: "HARD" } },
  ]);
  db.user.findUnique.mockResolvedValue({ firstName: "Sam" });
  db.categoryState.findMany.mockResolvedValue([{ category: "GRAMMAR", ability: 60 }]);
  db.rushChallenge.updateMany.mockResolvedValue({ count: 1 });
});

describe("tickLive matchmaking fallback", () => {
  it("keeps waiting for a human inside the window", async () => {
    db.rushChallenge.findUnique.mockResolvedValue(room({ createdAt: new Date(Date.now() - (RUSH_BOT_AFTER_MS - 5_000)) }));
    await tickLive("c1");
    expect(db.rushChallenge.updateMany).not.toHaveBeenCalled();
  });

  it("matches a bot once the window passes with nobody else in the lobby", async () => {
    db.rushChallenge.findUnique.mockResolvedValue(room({ createdAt: new Date(Date.now() - RUSH_BOT_AFTER_MS - 1_000) }));
    await tickLive("c1");
    expect(db.rushChallenge.updateMany).toHaveBeenCalledTimes(1);
    const arg = db.rushChallenge.updateMany.mock.calls[0][0];
    // The same atomic guard a human joiner uses, plus "no other student in the room".
    expect(arg.where).toMatchObject({ id: "c1", liveStatus: "WAITING", mode: "RANDOM", runs: { none: { studentId: { not: "me" } } } });
    expect(arg.data.liveStatus).toBe("COUNTDOWN");
    const profile = parseBotProfile(arg.data.bot);
    expect(profile).not.toBeNull();
    expect(profile!.name).not.toBe("Sam");
    expect(profile!.pCorrect).toHaveLength(3);
  });

  it("does nothing when a human found the lobby in time", async () => {
    db.rushChallenge.findUnique.mockResolvedValue(
      room({
        liveStatus: "COUNTDOWN",
        liveStartsAt: new Date(Date.now() + 4_000),
        createdAt: new Date(Date.now() - 40_000),
        runs: [
          { id: "r1", studentId: "me", answers: [] },
          { id: "r2", studentId: "them", answers: [] },
        ],
      }),
    );
    await tickLive("c1");
    expect(db.rushChallenge.updateMany).not.toHaveBeenCalled();
  });

  it("does not match a bot into a friend room or a rematch invitation", async () => {
    const old = new Date(Date.now() - 90_000);
    db.rushChallenge.findUnique.mockResolvedValueOnce(room({ mode: "FRIEND", createdAt: old }));
    await tickLive("c1");
    db.rushChallenge.findUnique.mockResolvedValueOnce(room({ invitedStudentId: "x", createdAt: old }));
    await tickLive("c1");
    expect(db.rushChallenge.updateMany).not.toHaveBeenCalled();
  });
});

describe("claimBotOpponent", () => {
  it("reports false when a human claimed the lobby first", async () => {
    db.rushChallenge.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimBotOpponent("c1", "me")).toBe(false);
  });

  it("reads the student's ability for the set's categories", async () => {
    expect(await claimBotOpponent("c1", "me")).toBe(true);
    const profile = parseBotProfile(db.rushChallenge.updateMany.mock.calls[0][0].data.bot)!;
    expect(profile.difficulties).toEqual(["EASY", "MEDIUM", "HARD"]);
    expect(db.categoryState.findMany.mock.calls[0][0].where.studentId).toBe("me");
    // GRAMMAR has an ability (60), VOCABULARY does not and falls back to the default.
    expect(profile.pCorrect[0]).toBeGreaterThan(profile.pCorrect[2]);
  });
});
