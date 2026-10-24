import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptRematch, getRematchState, listRematchInvites, requestRematch } from "@/lib/rush/rematch";
import { RushError } from "@/lib/rush/errors";
import { createChallenge } from "@/lib/rush/create";
import { joinLiveRoom } from "@/lib/rush/live";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mock: Record<string, unknown> = {
    rushChallenge: { findUnique: vi.fn(), findMany: vi.fn() },
    rushRun: { create: vi.fn(), findUnique: vi.fn() },
    rushSet: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };
  (mock.$transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => unknown) => fn(mock));
  return { prisma: mock };
});

vi.mock("@/lib/rush/create", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rush/create")>("@/lib/rush/create");
  return {
    isUniqueViolation: actual.isUniqueViolation,
    createSet: vi.fn().mockResolvedValue({ id: "set-new" }),
    createChallenge: vi.fn().mockResolvedValue({ id: "rematch-new", code: "ABC234" }),
  };
});

vi.mock("@/lib/rush/live", () => ({ joinLiveRoom: vi.fn().mockResolvedValue({ runId: "run-joined", challengeId: "x" }) }));

const mocked = prisma as unknown as {
  rushChallenge: Record<string, ReturnType<typeof vi.fn>>;
  rushRun: Record<string, ReturnType<typeof vi.fn>>;
  rushSet: Record<string, ReturnType<typeof vi.fn>>;
};
const mockedCreateChallenge = createChallenge as unknown as ReturnType<typeof vi.fn>;
const mockedJoinLive = joinLiveRoom as unknown as ReturnType<typeof vi.fn>;

const NOW = Date.now();

type RematchRow = {
  id: string;
  live: boolean;
  liveStatus: string | null;
  creatorId: string;
  invitedStudentId: string | null;
  runs: { id: string; studentId: string; status: string; lastSeenAt: Date }[];
};

/** A finished head-to-head between "me" and "ada", optionally already rematched. */
function match(opts: { mode?: string; live?: boolean; myStatus?: string; adaStatus?: string; rematch?: RematchRow | null } = {}) {
  return {
    id: "match1",
    mode: opts.mode ?? "RANDOM",
    live: opts.live ?? true,
    set: { section: "MATH" },
    runs: [
      { studentId: "ada", status: opts.adaStatus ?? "COMPLETED", student: { firstName: "Ada" } },
      { studentId: "me", status: opts.myStatus ?? "COMPLETED", student: { firstName: "Me" } },
    ],
    rematch: opts.rematch ?? null,
  };
}

function rematchRow(overrides: Partial<RematchRow> = {}): RematchRow {
  return {
    id: "rematch1",
    live: true,
    liveStatus: "WAITING",
    creatorId: "ada",
    invitedStudentId: "me",
    runs: [{ id: "run-ada", studentId: "ada", status: "ACTIVE", lastSeenAt: new Date(NOW) }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateChallenge.mockResolvedValue({ id: "rematch-new", code: "ABC234" });
  mocked.rushRun.create.mockResolvedValue({ id: "run-new" });
});

describe("getRematchState", () => {
  it("offers nothing after a solo run", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(match({ mode: "SOLO" }));
    expect(await getRematchState("me", "match1")).toEqual({ kind: "UNAVAILABLE" });
  });

  it("offers nothing until this student has finished", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(match({ myStatus: "ACTIVE" }));
    expect((await getRematchState("me", "match1")).kind).toBe("UNAVAILABLE");
  });

  it("offers nothing until the opponent has finished", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(match({ adaStatus: "ACTIVE" }));
    expect((await getRematchState("me", "match1")).kind).toBe("UNAVAILABLE");
  });

  it("offers a rematch against the opponent once both are done", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(match());
    expect(await getRematchState("me", "match1")).toEqual({ kind: "NONE", opponentName: "Ada" });
  });

  it("shows an incoming invitation while its sender is in the room", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(match({ rematch: rematchRow() }));
    expect(await getRematchState("me", "match1")).toEqual({
      kind: "RECEIVED",
      challengeId: "rematch1",
      live: true,
      opponentName: "Ada",
    });
  });

  it("treats an invitation to an abandoned room as no rematch at all", async () => {
    const stale = rematchRow({
      runs: [{ id: "run-ada", studentId: "ada", status: "ACTIVE", lastSeenAt: new Date(NOW - 5 * 60_000) }],
    });
    mocked.rushChallenge.findUnique.mockResolvedValue(match({ rematch: stale }));
    expect((await getRematchState("me", "match1")).kind).toBe("NONE");
  });

  it("shows the sender that their rematch is out", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(
      match({
        rematch: rematchRow({
          creatorId: "me",
          invitedStudentId: "ada",
          runs: [{ id: "run-me", studentId: "me", status: "ACTIVE", lastSeenAt: new Date(NOW) }],
        }),
      }),
    );
    expect(await getRematchState("me", "match1")).toMatchObject({ kind: "SENT", challengeId: "rematch1", runId: "run-me" });
  });

  it("links to the result once this student has played the rematch", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(
      match({
        rematch: rematchRow({
          liveStatus: "FINISHED",
          runs: [
            { id: "run-ada", studentId: "ada", status: "COMPLETED", lastSeenAt: new Date(NOW) },
            { id: "run-me", studentId: "me", status: "COMPLETED", lastSeenAt: new Date(NOW) },
          ],
        }),
      }),
    );
    expect(await getRematchState("me", "match1")).toEqual({ kind: "PLAYED", challengeId: "rematch1" });
  });

  it("stays out of a rematch between two other players", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(
      match({ rematch: rematchRow({ creatorId: "ada", invitedStudentId: "cy" }) }),
    );
    expect((await getRematchState("me", "match1")).kind).toBe("UNAVAILABLE");
  });
});

describe("requestRematch", () => {
  it("opens a rematch for the opponent, in the same style as the match", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(match({ live: true }));

    const where = await requestRematch("me", "match1");

    expect(where).toEqual({ live: true, challengeId: "rematch-new" });
    expect(mockedCreateChallenge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: "FRIEND",
        creatorId: "me",
        live: true,
        liveStatus: "WAITING",
        rematchOfId: "match1",
        invitedStudentId: "ada",
      }),
    );
  });

  it("starts the sender's run straight away for a recorded rematch", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(match({ live: false }));

    expect(await requestRematch("me", "match1")).toEqual({ live: false, challengeId: "rematch-new", runId: "run-new" });
  });

  it("accepts the opponent's rematch instead of opening a second room", async () => {
    mocked.rushChallenge.findUnique
      .mockResolvedValueOnce(match({ rematch: rematchRow() }))
      .mockResolvedValueOnce({ id: "rematch1", live: true, invitedStudentId: "me", creatorId: "ada", runs: [] });

    const where = await requestRematch("me", "match1");

    expect(where).toEqual({ live: true, challengeId: "rematch1" });
    expect(mockedJoinLive).toHaveBeenCalledWith("me", "rematch1");
    expect(mockedCreateChallenge).not.toHaveBeenCalled();
  });

  it("is idempotent for the student who already asked", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(
      match({
        rematch: rematchRow({
          creatorId: "me",
          invitedStudentId: "ada",
          runs: [{ id: "run-me", studentId: "me", status: "ACTIVE", lastSeenAt: new Date(NOW) }],
        }),
      }),
    );

    expect(await requestRematch("me", "match1")).toEqual({ live: true, challengeId: "rematch1" });
    expect(mockedCreateChallenge).not.toHaveBeenCalled();
  });

  it("clears an abandoned rematch room and opens a fresh one", async () => {
    const stale = rematchRow({
      runs: [{ id: "run-ada", studentId: "ada", status: "ACTIVE", lastSeenAt: new Date(NOW - 5 * 60_000) }],
    });
    mocked.rushChallenge.findUnique.mockResolvedValue(match({ rematch: stale }));

    await requestRematch("me", "match1");

    expect(mocked.rushSet.deleteMany).toHaveBeenCalled();
    expect(mockedCreateChallenge).toHaveBeenCalled();
  });

  it("joins the opponent's rematch when both press Rematch in the same instant", async () => {
    mocked.rushChallenge.findUnique
      .mockResolvedValueOnce(match()) // no rematch yet when we read
      .mockResolvedValueOnce({ id: "rematch1", live: true, creatorId: "ada", invitedStudentId: "me" }) // the winner
      .mockResolvedValueOnce({ id: "rematch1", live: true, invitedStudentId: "me", creatorId: "ada", runs: [] });
    mockedCreateChallenge.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));

    const where = await requestRematch("me", "match1");

    expect(where).toEqual({ live: true, challengeId: "rematch1" });
    expect(mockedJoinLive).toHaveBeenCalledWith("me", "rematch1");
  });

  it("refuses when there's nobody to rematch", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue(match({ mode: "SOLO" }));

    await expect(requestRematch("me", "match1")).rejects.toBeInstanceOf(RushError);
  });
});

describe("acceptRematch", () => {
  it("only lets the invited student in", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue({ id: "rematch1", live: true, invitedStudentId: "ada", creatorId: "cy", runs: [] });

    await expect(acceptRematch("me", "rematch1")).rejects.toBeInstanceOf(RushError);
    expect(mockedJoinLive).not.toHaveBeenCalled();
  });

  it("joins a live rematch through the room's own claim", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue({ id: "rematch1", live: true, invitedStudentId: "me", creatorId: "ada", runs: [] });

    expect(await acceptRematch("me", "rematch1")).toEqual({ live: true, challengeId: "rematch1" });
    expect(mockedJoinLive).toHaveBeenCalledWith("me", "rematch1");
  });

  it("starts a run on a recorded rematch", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue({ id: "rematch1", live: false, invitedStudentId: "me", creatorId: "ada", runs: [] });

    expect(await acceptRematch("me", "rematch1")).toEqual({ live: false, challengeId: "rematch1", runId: "run-new" });
  });

  it("returns the existing run when accepted twice", async () => {
    mocked.rushChallenge.findUnique.mockResolvedValue({
      id: "rematch1",
      live: false,
      invitedStudentId: "me",
      creatorId: "ada",
      runs: [{ id: "run-me" }],
    });
    mocked.rushRun.findUnique.mockResolvedValue({ id: "run-me" });

    expect(await acceptRematch("me", "rematch1")).toEqual({ live: false, challengeId: "rematch1", runId: "run-me" });
    expect(mocked.rushRun.create).not.toHaveBeenCalled();
  });
});

describe("listRematchInvites", () => {
  it("lists recorded invitations and live ones whose sender is still in the room", async () => {
    mocked.rushChallenge.findMany.mockResolvedValue([
      {
        id: "live-open",
        live: true,
        liveStatus: "WAITING",
        createdAt: new Date(NOW),
        creatorId: "ada",
        creator: { firstName: "Ada" },
        set: { section: "MATH" },
        runs: [{ studentId: "ada", lastSeenAt: new Date(NOW) }],
      },
      {
        id: "live-abandoned",
        live: true,
        liveStatus: "WAITING",
        createdAt: new Date(NOW),
        creatorId: "ben",
        creator: { firstName: "Ben" },
        set: { section: "MATH" },
        runs: [{ studentId: "ben", lastSeenAt: new Date(NOW - 5 * 60_000) }],
      },
      {
        id: "recorded",
        live: false,
        liveStatus: null,
        createdAt: new Date(NOW),
        creatorId: "cy",
        creator: { firstName: "Cy" },
        set: { section: "READING_WRITING" },
        runs: [{ studentId: "cy", lastSeenAt: new Date(NOW - 60 * 60_000) }],
      },
    ]);

    const invites = await listRematchInvites("me");

    expect(invites.map((i) => i.challengeId)).toEqual(["live-open", "recorded"]);
    expect(invites[0]).toMatchObject({ fromName: "Ada", live: true });
  });
});
