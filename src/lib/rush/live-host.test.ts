import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelLiveRoom, hostStarts, joinLiveRoom, startLiveRoom } from "@/lib/rush/live";
import { RushError } from "@/lib/rush/errors";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const p: Record<string, unknown> = {
    rushChallenge: { findUnique: vi.fn(), updateMany: vi.fn() },
    rushRun: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    rushSet: { delete: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  p.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(p));
  return { prisma: p };
});

type Fn = ReturnType<typeof vi.fn>;
const m = prisma as unknown as {
  rushChallenge: { findUnique: Fn; updateMany: Fn };
  rushRun: { findUnique: Fn; create: Fn; deleteMany: Fn };
  rushSet: { delete: Fn };
  $queryRaw: Fn;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.rushRun.findUnique.mockResolvedValue(null);
  m.rushRun.create.mockResolvedValue({ id: "run2" });
});

describe("hostStarts", () => {
  it("is a friend's room; a random match and a rematch start themselves", () => {
    expect(hostStarts({ mode: "FRIEND", rematchOfId: null })).toBe(true);
    expect(hostStarts({ mode: "FRIEND", rematchOfId: "c0" })).toBe(false);
    expect(hostStarts({ mode: "RANDOM", rematchOfId: null })).toBe(false);
  });
});

describe("joinLiveRoom in a room that waits for Start", () => {
  const room = { live: true, mode: "FRIEND", rematchOfId: null, liveStatus: "WAITING", invitedStudentId: null, runs: [{ lastSeenAt: new Date() }] };

  it("adds the second player and leaves the room waiting, under a row lock", async () => {
    m.rushChallenge.findUnique.mockResolvedValueOnce(room).mockResolvedValueOnce({ liveStatus: "WAITING", _count: { runs: 1 } });

    await expect(joinLiveRoom("guest", "c1")).resolves.toEqual({ runId: "run2", challengeId: "c1" });
    expect(m.$queryRaw).toHaveBeenCalledOnce();
    expect(m.rushChallenge.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a third player", async () => {
    m.rushChallenge.findUnique.mockResolvedValueOnce(room).mockResolvedValueOnce({ liveStatus: "WAITING", _count: { runs: 2 } });

    await expect(joinLiveRoom("third", "c1")).rejects.toBeInstanceOf(RushError);
    expect(m.rushRun.create).not.toHaveBeenCalled();
  });
});

describe("startLiveRoom", () => {
  it("only the host, only a friend's waiting room, only with someone else in it", async () => {
    m.rushChallenge.updateMany.mockResolvedValue({ count: 1 });

    expect(await startLiveRoom("host", "c1")).toBe(true);
    const { where, data } = m.rushChallenge.updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ id: "c1", creatorId: "host", mode: "FRIEND", rematchOfId: null, liveStatus: "WAITING" });
    expect(where.runs).toEqual({ some: { studentId: { not: "host" } } });
    expect(data.liveStatus).toBe("COUNTDOWN");
  });

  it("reports a second press as not starting it again", async () => {
    m.rushChallenge.updateMany.mockResolvedValue({ count: 0 });
    expect(await startLiveRoom("host", "c1")).toBe(false);
  });
});

describe("cancelLiveRoom before Start", () => {
  it("closes the room when the host leaves", async () => {
    m.rushChallenge.findUnique.mockResolvedValue({ setId: "s1", creatorId: "host", live: true, liveStatus: "WAITING", mode: "FRIEND", rematchOfId: null });
    expect(await cancelLiveRoom("host", "c1")).toBe(true);
    expect(m.rushSet.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("lets the second player step out, keeping the host's room", async () => {
    m.rushChallenge.findUnique.mockResolvedValue({ setId: "s1", creatorId: "host", live: true, liveStatus: "WAITING", mode: "FRIEND", rematchOfId: null });
    m.rushRun.deleteMany.mockResolvedValue({ count: 1 });
    expect(await cancelLiveRoom("guest", "c1")).toBe(true);
    expect(m.rushSet.delete).not.toHaveBeenCalled();
    expect(m.rushRun.deleteMany.mock.calls[0][0].where).toMatchObject({ challengeId: "c1", studentId: "guest" });
  });

  it("leaves a match in progress alone", async () => {
    m.rushChallenge.findUnique.mockResolvedValue({ setId: "s1", creatorId: "host", live: true, liveStatus: "PLAYING", mode: "FRIEND", rematchOfId: null });
    expect(await cancelLiveRoom("guest", "c1")).toBe(false);
    expect(m.rushRun.deleteMany).not.toHaveBeenCalled();
  });
});
