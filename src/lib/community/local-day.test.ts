import { describe, expect, it } from "vitest";
import { nextUtcDayLocalTime } from "./local-day";

describe("nextUtcDayLocalTime", () => {
  // The Daily Challenge turns over at midnight UTC: the same evening in Texas.
  it("is 6 p.m. in Central standard time", () => {
    expect(nextUtcDayLocalTime(new Date("2026-11-20T15:00:00Z"))).toBe("6 p.m.");
  });

  it("is 7 p.m. in Central daylight time", () => {
    expect(nextUtcDayLocalTime(new Date("2026-07-20T15:00:00Z"))).toBe("7 p.m.");
  });

  it("names the next turnover, not the one that just passed", () => {
    // 11:30pm UTC on the 20th is 5:30pm Central: the turnover is 30 minutes away.
    expect(nextUtcDayLocalTime(new Date("2026-11-20T23:30:00Z"))).toBe("6 p.m.");
  });
});
