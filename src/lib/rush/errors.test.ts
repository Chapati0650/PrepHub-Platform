import { describe, expect, it } from "vitest";
import { RUSH_HUB_ERRORS, RushError, isRushProblem, rushError, rushHubErrorMessage, rushProblem } from "./errors";

describe("rushHubErrorMessage", () => {
  it("maps a known key to its fixed sentence", () => {
    expect(rushHubErrorMessage("room-full")).toBe(RUSH_HUB_ERRORS["room-full"]);
  });

  it("prints nothing for text that isn't a key — the hub must never echo the URL", () => {
    expect(rushHubErrorMessage("Your account is suspended. Call 555-0100.")).toBeNull();
    expect(rushHubErrorMessage(undefined)).toBeNull();
    expect(rushHubErrorMessage("")).toBeNull();
  });

  it("isn't fooled by keys every object inherits", () => {
    expect(rushHubErrorMessage("toString")).toBeNull();
    expect(rushHubErrorMessage("__proto__")).toBeNull();
  });
});

describe("rushError", () => {
  it("carries its hub key, with the hub's own sentence as the message", () => {
    const err = rushError("NOT_JOINABLE", "host-away");
    expect(err).toBeInstanceOf(RushError);
    expect(err.code).toBe("NOT_JOINABLE");
    expect(err.hubKey).toBe("host-away");
    expect(err.message).toBe(RUSH_HUB_ERRORS["host-away"]);
  });

  it("falls back to a key for its code when thrown without one", () => {
    expect(new RushError("RUN_NOT_FOUND", "Rush not found.").hubKey).toBe("not-found");
    expect(new RushError("RUN_COMPLETED", "This rush is already finished.").hubKey).toBe("finished");
  });

  it("says nothing about a difficulty picker that no longer exists", () => {
    expect(RUSH_HUB_ERRORS["no-questions"]).not.toMatch(/difficulty/i);
  });
});

describe("rushProblem", () => {
  it("sorts the errors a runner can meet into what it should do about them", () => {
    expect(rushProblem(new RushError("RUN_COMPLETED", "x"))).toEqual({ problem: "FINISHED" });
    expect(rushProblem(new RushError("NOT_SERVED", "x"))).toEqual({ problem: "OUT_OF_STEP" });
    expect(rushProblem(new RushError("RUN_NOT_FOUND", "x"))).toEqual({ problem: "GONE" });
  });

  it("is told apart from a real result", () => {
    expect(isRushProblem({ problem: "GONE" })).toBe(true);
    expect(isRushProblem({ isCorrect: true, points: 150 })).toBe(false);
    expect(isRushProblem(null)).toBe(false);
  });
});
