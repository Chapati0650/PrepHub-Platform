import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWeeklyLeaderboard, rankRows, weekBounds } from "@/lib/rush/leaderboard";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    studentMembership: { findUnique: vi.fn() },
    administratorAssignment: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

const mocked = prisma as unknown as {
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  administratorAssignment: Record<string, ReturnType<typeof vi.fn>>;
  $queryRaw: ReturnType<typeof vi.fn>;
};

// The week resets Monday at midnight Central. In October that's 05:00 UTC
// (CDT, UTC−5); from November 1, 2026 it's 06:00 UTC (CST, UTC−6).
describe("weekBounds", () => {
  it("runs Monday midnight to Monday midnight, Central", () => {
    // Wednesday 2026-10-21, noon Central.
    const { start, end } = weekBounds(new Date("2026-10-21T17:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-19T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-26T05:00:00.000Z");
  });

  it("keeps Sunday evening in the same week — a UTC week would already have reset", () => {
    // Sunday 2026-10-25, 7:30pm Central = Monday 00:30 UTC.
    const { start } = weekBounds(new Date("2026-10-26T00:30:00Z"));
    expect(start.toISOString()).toBe("2026-10-19T05:00:00.000Z");
  });

  it("starts a new week the minute Monday begins in Texas", () => {
    // Monday 2026-10-26, 12:01am Central.
    const { start } = weekBounds(new Date("2026-10-26T05:01:00Z"));
    expect(start.toISOString()).toBe("2026-10-26T05:00:00.000Z");
  });

  it("handles a week the clocks change in — it's an hour longer, and ends at local midnight", () => {
    // Daylight saving ends Sunday 2026-11-01. The week of Monday Oct 26 starts
    // at 05:00 UTC (CDT) and ends Monday Nov 2 at 06:00 UTC (CST).
    const { start, end } = weekBounds(new Date("2026-10-29T15:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-26T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });

  it("treats Monday itself as the first day, not the last", () => {
    // Monday 2026-10-19, 9am Central.
    const { start } = weekBounds(new Date("2026-10-19T14:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-19T05:00:00.000Z");
  });
});

describe("rankRows", () => {
  it("shares a place between equal scores and skips the next", () => {
    const ranked = rankRows([{ score: 1900 }, { score: 1700 }, { score: 1700 }, { score: 1500 }]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it("returns nothing for nothing", () => {
    expect(rankRows([])).toEqual([]);
  });
});

function row(studentId: string, score: number, opts: { hidden?: boolean; runs?: number; firstName?: string } = {}) {
  return {
    studentId,
    score,
    firstName: opts.firstName ?? studentId,
    classYear: 2027,
    hidden: opts.hidden ?? false,
    runs: opts.runs ?? 1,
  };
}

function givenSchool(enabled = true, districtEnabled: boolean | null = null) {
  mocked.studentMembership.findUnique.mockResolvedValue({
    status: "ACTIVE",
    school: {
      id: "school1",
      officialName: "Aledo High School",
      rushLeaderboardEnabled: enabled,
      parentDistrict: districtEnabled === null ? null : { rushLeaderboardEnabled: districtEnabled },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.administratorAssignment.findFirst.mockResolvedValue(null);
  givenSchool();
  mocked.$queryRaw.mockResolvedValue([]);
});

/** First $queryRaw call is this week, second is last week. */
function givenWeeks(thisWeek: ReturnType<typeof row>[], lastWeek: ReturnType<typeof row>[] = []) {
  mocked.$queryRaw.mockResolvedValueOnce(thisWeek).mockResolvedValueOnce(lastWeek);
}

describe("getWeeklyLeaderboard", () => {
  it("ranks each student's best run, with the viewer marked", async () => {
    givenWeeks([row("ada", 1900), row("me", 1700), row("ben", 1500)]);

    const board = await getWeeklyLeaderboard("me");

    expect(board?.entries.map((e) => [e.rank, e.firstName, e.isMe])).toEqual([
      [1, "ada", false],
      [2, "me", true],
      [3, "ben", false],
    ]);
    expect(board?.me).toEqual({ rank: 2, score: 1700, runs: 1, hidden: false });
    expect(board?.players).toBe(3);
  });

  it("leaves a hidden student off everyone else's board without leaving a gap", async () => {
    givenWeeks([row("ada", 1900), row("ghost", 1800, { hidden: true }), row("ben", 1500)]);

    const board = await getWeeklyLeaderboard("me");

    // Ben is second, not third: nobody can count the gap to infer a hidden player.
    expect(board?.entries.map((e) => [e.rank, e.firstName])).toEqual([
      [1, "ada"],
      [2, "ben"],
    ]);
    expect(JSON.stringify(board)).not.toContain("ghost");
  });

  it("still tells a hidden student where they'd stand", async () => {
    givenWeeks([row("ada", 1900), row("me", 1800, { hidden: true }), row("ben", 1500)]);

    const board = await getWeeklyLeaderboard("me");

    expect(board?.me).toEqual({ rank: 2, score: 1800, runs: 1, hidden: true });
    expect(board?.entries.some((e) => e.isMe)).toBe(false);
  });

  it("lists only the top ten", async () => {
    givenWeeks(Array.from({ length: 14 }, (_, i) => row(`s${i}`, 2000 - i * 10)));

    const board = await getWeeklyLeaderboard("me");

    expect(board?.entries).toHaveLength(10);
    expect(board?.players).toBe(14);
  });

  it("shows last week's podium", async () => {
    givenWeeks([], [row("ada", 1900), row("ben", 1700), row("cy", 1600), row("di", 1500)]);

    const board = await getWeeklyLeaderboard("me");

    expect(board?.lastWeek.map((e) => e.firstName)).toEqual(["ada", "ben", "cy"]);
  });

  it("reports no standing for a viewer who hasn't finished a rush this week", async () => {
    givenWeeks([row("ada", 1900)]);

    expect((await getWeeklyLeaderboard("me"))?.me).toBeNull();
  });

  it("returns nothing for a student with no school", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(null);

    expect(await getWeeklyLeaderboard("me")).toBeNull();
    expect(mocked.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns nothing when the school has the board turned off", async () => {
    givenSchool(false);

    expect(await getWeeklyLeaderboard("me")).toBeNull();
  });

  it("returns nothing when the district has it off, even if the school has it on", async () => {
    givenSchool(true, false);

    expect(await getWeeklyLeaderboard("me")).toBeNull();
  });

  it("shows an administrator their school's board", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(null);
    mocked.administratorAssignment.findFirst.mockResolvedValue({
      organization: { id: "school1", officialName: "Aledo High School", rushLeaderboardEnabled: true, parentDistrict: null },
    });
    givenWeeks([row("ada", 1900)]);

    const board = await getWeeklyLeaderboard("admin1");

    expect(board?.scope.schoolName).toBe("Aledo High School");
    expect(board?.me).toBeNull();
  });

  it("ignores a membership that isn't ACTIVE", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue({
      status: "GRADUATED",
      school: { id: "school1", officialName: "Aledo High School", rushLeaderboardEnabled: true, parentDistrict: null },
    });

    expect(await getWeeklyLeaderboard("me")).toBeNull();
  });
});
