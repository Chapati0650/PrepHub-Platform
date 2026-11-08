import { describe, expect, it } from "vitest";
import type { QuestionDifficulty } from "@/generated/prisma/client";
import {
  BOT_BUZZER_MARGIN_MS,
  BOT_MIN_ANSWER_MS,
  BOT_NAMES,
  BOT_P_MAX,
  BOT_P_MIN,
  botAnswer,
  botAvatar,
  botHasAnswered,
  botRounds,
  botSnapshot,
  buildBotProfile,
  lobbyDecision,
  parseBotProfile,
  seededRandom,
} from "./bot";
import { RUSH_BOT_AFTER_MS, RUSH_TIME_LIMIT_MS } from "./config";
import { maxRushScore } from "./scoring";

const DIFFS: QuestionDifficulty[] = ["EASY", "MEDIUM", "HARD", "EASY", "MEDIUM", "HARD", "EASY", "MEDIUM", "HARD", "MEDIUM"];
const slots = (p: number | null) => DIFFS.map((difficulty) => ({ difficulty, expectedP: p }));
const LIMIT = RUSH_TIME_LIMIT_MS.READING_WRITING;

describe("seededRandom", () => {
  it("is deterministic and stays in [0, 1)", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 200; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
  });
});

describe("buildBotProfile", () => {
  it("is deterministic for a seed and picks from the fixed lists", () => {
    const a = buildBotProfile({ seed: 7, slots: slots(0.6) });
    expect(buildBotProfile({ seed: 7, slots: slots(0.6) })).toEqual(a);
    expect(BOT_NAMES).toContain(a.name);
    expect(botAvatar(a).initial).toBe(a.name[0]);
    expect(a.pCorrect).toHaveLength(10);
  });

  it("never reuses the student's own first name", () => {
    for (let seed = 1; seed <= 300; seed++) {
      expect(buildBotProfile({ seed, slots: slots(null), avoidName: "  maya " }).name).not.toBe("Maya");
    }
  });

  it("keeps accuracy inside its bounds and follows the student's ability", () => {
    let lowSum = 0;
    let highSum = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const low = buildBotProfile({ seed, slots: slots(0.3) }).pCorrect;
      const high = buildBotProfile({ seed, slots: slots(0.85) }).pCorrect;
      for (const p of [...low, ...high]) {
        expect(p).toBeGreaterThanOrEqual(BOT_P_MIN);
        expect(p).toBeLessThanOrEqual(BOT_P_MAX);
      }
      lowSum += low.reduce((a, b) => a + b, 0) / 10;
      highSum += high.reduce((a, b) => a + b, 0) / 10;
    }
    expect(lowSum / 200).toBeCloseTo(0.3, 1);
    expect(highSum / 200).toBeCloseTo(0.85, 1);
  });

  it("falls back to a per-difficulty guess with no ability on file", () => {
    let easy = 0;
    let hard = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const p = buildBotProfile({ seed, slots: slots(null) }).pCorrect;
      easy += p[0];
      hard += p[2];
    }
    expect(easy / 200).toBeGreaterThan(hard / 200 + 0.25);
  });

  it("round-trips through JSON and rejects malformed profiles", () => {
    const p = buildBotProfile({ seed: 9, slots: slots(0.5) });
    expect(parseBotProfile(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(parseBotProfile(null)).toBeNull();
    expect(parseBotProfile({ ...p, v: 2 })).toBeNull();
    expect(parseBotProfile({ ...p, pCorrect: [0.5] })).toBeNull();
  });
});

describe("botAnswer timing and accuracy", () => {
  it("is deterministic and never answers outside the floor and the buzzer margin", () => {
    for (const limit of [RUSH_TIME_LIMIT_MS.READING_WRITING, RUSH_TIME_LIMIT_MS.MATH]) {
      for (let seed = 1; seed <= 150; seed++) {
        const profile = buildBotProfile({ seed, slots: slots(0.6) });
        for (let pos = 0; pos < 10; pos++) {
          const a = botAnswer(profile, pos, limit);
          expect(botAnswer(profile, pos, limit)).toEqual(a);
          if (a.timedOut) {
            expect(a.isCorrect).toBe(false);
            expect(a.elapsedMs).toBe(limit);
          } else {
            expect(a.elapsedMs).toBeGreaterThanOrEqual(BOT_MIN_ANSWER_MS);
            expect(a.elapsedMs).toBeLessThanOrEqual(limit - BOT_BUZZER_MARGIN_MS);
          }
        }
      }
    }
  });

  it("scales answer time with difficulty and the question's clock", () => {
    const mean = (limit: number, pos: number) => {
      let sum = 0;
      let n = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const a = botAnswer(buildBotProfile({ seed, slots: slots(0.6) }), pos, limit);
        if (!a.timedOut) {
          sum += a.elapsedMs;
          n++;
        }
      }
      return sum / n;
    };
    expect(mean(LIMIT, 2)).toBeGreaterThan(mean(LIMIT, 0) * 1.5); // HARD slower than EASY
    expect(mean(RUSH_TIME_LIMIT_MS.MATH, 1)).toBeGreaterThan(mean(LIMIT, 1) * 1.3);
  });

  it("is right about as often as its profile says, and sometimes wrong", () => {
    let right = 0;
    let total = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const profile = buildBotProfile({ seed, slots: slots(0.7) });
      for (let pos = 0; pos < 10; pos++) {
        right += botAnswer(profile, pos, LIMIT).isCorrect ? 1 : 0;
        total++;
      }
    }
    expect(right / total).toBeGreaterThan(0.6);
    expect(right / total).toBeLessThan(0.76);
  });

  it("can win or lose: scores vary widely across seeds and stay in range", () => {
    const scores = Array.from({ length: 300 }, (_, i) =>
      botRounds(buildBotProfile({ seed: i + 1, slots: slots(0.65) }), LIMIT, 2).reduce((n, r) => n + r.points, 0),
    );
    expect(Math.max(...scores)).toBeGreaterThan(Math.min(...scores) + 400);
    expect(Math.max(...scores)).toBeLessThanOrEqual(maxRushScore(2, 10));
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0);
  });
});

describe("botRounds", () => {
  it("scores by the challenge's own rules, with the streak bonus only under version 2", () => {
    const profile = {
      ...buildBotProfile({ seed: 3, slots: slots(0.92) }),
      pCorrect: Array<number>(10).fill(1),
      difficulties: Array<QuestionDifficulty>(10).fill("EASY"),
    };
    const v1 = botRounds(profile, LIMIT, 1);
    const v2 = botRounds(profile, LIMIT, 2);
    expect(v1.filter((r) => r.isCorrect).length).toBeGreaterThan(5);
    expect(v2.reduce((n, r) => n + r.points, 0)).toBeGreaterThan(v1.reduce((n, r) => n + r.points, 0));
    expect(v1.every((r) => (r.isCorrect ? r.points > 0 : r.points === 0))).toBe(true);
  });
});

describe("what the room shows at a moment in time", () => {
  const rounds = botRounds(buildBotProfile({ seed: 11, slots: slots(0.6) }), LIMIT, 2);

  it("reveals the answer only once its time has passed", () => {
    const t = rounds[4].elapsedMs;
    expect(botHasAnswered(rounds, 4, 4, t - 1)).toBe(false);
    expect(botHasAnswered(rounds, 4, 4, t)).toBe(true);
    expect(botHasAnswered(rounds, 4, 4, null)).toBe(false);
    expect(botHasAnswered(rounds, 3, 4, null)).toBe(true);
    expect(botHasAnswered(rounds, 5, 4, LIMIT)).toBe(false);
  });

  it("adds up only the answers already in", () => {
    expect(botSnapshot(rounds, 0, null)).toEqual({ score: 0, correctCount: 0 });
    const done = botSnapshot(rounds, rounds.length, null);
    expect(done.score).toBe(rounds.reduce((n, r) => n + r.points, 0));
    expect(done.correctCount).toBe(rounds.filter((r) => r.isCorrect).length);
    const mid = botSnapshot(rounds, 3, 0);
    expect(mid.score).toBe(rounds.slice(0, 3).reduce((n, r) => n + r.points, 0));
  });
});

describe("lobbyDecision (the 15 second fallback)", () => {
  const base = { mode: "RANDOM" as const, liveStatus: "WAITING", runCount: 1, invited: false, botEnabled: true };

  it("waits for a human until the threshold, then offers the bot", () => {
    expect(lobbyDecision({ ...base, waitedMs: 0 })).toBe("WAIT");
    expect(lobbyDecision({ ...base, waitedMs: RUSH_BOT_AFTER_MS - 1 })).toBe("WAIT");
    expect(lobbyDecision({ ...base, waitedMs: RUSH_BOT_AFTER_MS })).toBe("MATCH_BOT");
    expect(lobbyDecision({ ...base, waitedMs: 60_000 })).toBe("MATCH_BOT");
  });

  it("never offers a bot once a human has joined or the room moved on", () => {
    expect(lobbyDecision({ ...base, waitedMs: 99_000, runCount: 2 })).toBe("WAIT");
    expect(lobbyDecision({ ...base, waitedMs: 99_000, liveStatus: "COUNTDOWN" })).toBe("WAIT");
    expect(lobbyDecision({ ...base, waitedMs: 99_000, liveStatus: "PLAYING" })).toBe("WAIT");
  });

  it("only ever applies to an open random lobby", () => {
    expect(lobbyDecision({ ...base, waitedMs: 99_000, mode: "FRIEND" })).toBe("WAIT");
    expect(lobbyDecision({ ...base, waitedMs: 99_000, mode: "SOLO" })).toBe("WAIT");
    expect(lobbyDecision({ ...base, waitedMs: 99_000, invited: true })).toBe("WAIT");
    expect(lobbyDecision({ ...base, waitedMs: 99_000, botEnabled: false })).toBe("WAIT");
  });
});
