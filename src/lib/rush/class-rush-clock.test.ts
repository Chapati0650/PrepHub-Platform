import { describe, expect, it } from "vitest";
import { CLASS_RUSH_REVEAL_MS, classRushPhase, nextClassRushStep, placesFor } from "@/lib/rush/class-rush-clock";
import { RUSH_GRACE_MS } from "@/lib/rush/config";

const T = 1_000_000;
const at = (ms: number) => new Date(T + ms);
const base = { status: "PLAYING" as const, position: 0, total: 5, players: 3, answered: 0, limitMs: 60_000, openedAt: at(0), closedAt: null };

describe("classRushPhase", () => {
  it("follows the game from lobby to finish", () => {
    expect(classRushPhase({ status: "LOBBY", openedAt: null, closedAt: null }, T)).toBe("LOBBY");
    expect(classRushPhase({ status: "PLAYING", openedAt: at(5_000), closedAt: null }, T)).toBe("COUNTDOWN");
    expect(classRushPhase({ status: "PLAYING", openedAt: at(0), closedAt: null }, T + 1)).toBe("QUESTION");
    expect(classRushPhase({ status: "PLAYING", openedAt: at(0), closedAt: at(10_000) }, T + 11_000)).toBe("REVEAL");
    expect(classRushPhase({ status: "FINISHED", openedAt: at(0), closedAt: at(1) }, T)).toBe("FINISHED");
  });
});

describe("nextClassRushStep", () => {
  it("waits during the countdown and while answers are still coming", () => {
    expect(nextClassRushStep({ ...base, openedAt: at(5_000) }, T)).toBe("NONE");
    expect(nextClassRushStep({ ...base, answered: 2 }, T + 10_000)).toBe("NONE");
  });

  it("closes the question as soon as everyone has answered", () => {
    expect(nextClassRushStep({ ...base, answered: 3 }, T + 4_000)).toBe("CLOSE");
  });

  it("closes when the clock and the grace run out, whoever hasn't answered", () => {
    expect(nextClassRushStep({ ...base, answered: 1 }, T + 60_000 + RUSH_GRACE_MS - 1)).toBe("NONE");
    expect(nextClassRushStep({ ...base, answered: 1 }, T + 60_000 + RUSH_GRACE_MS)).toBe("CLOSE");
  });

  it("never closes an empty game early", () => {
    expect(nextClassRushStep({ ...base, players: 0 }, T + 1_000)).toBe("NONE");
  });

  it("shows the reveal, then opens the next question, then finishes after the last", () => {
    const closed = { ...base, closedAt: at(8_000) };
    expect(nextClassRushStep(closed, T + 8_000 + CLASS_RUSH_REVEAL_MS - 1)).toBe("NONE");
    expect(nextClassRushStep(closed, T + 8_000 + CLASS_RUSH_REVEAL_MS)).toBe("NEXT");
    expect(nextClassRushStep({ ...closed, position: 4 }, T + 8_000 + CLASS_RUSH_REVEAL_MS)).toBe("FINISH");
  });

  it("does nothing outside a game in play", () => {
    expect(nextClassRushStep({ ...base, status: "LOBBY" }, T + 999_999)).toBe("NONE");
    expect(nextClassRushStep({ ...base, status: "FINISHED" }, T + 999_999)).toBe("NONE");
  });
});

describe("placesFor", () => {
  it("shares a place on equal scores and skips the next", () => {
    expect(placesFor([900, 700, 700, 500])).toEqual([1, 2, 2, 4]);
    expect(placesFor([])).toEqual([]);
  });
});
