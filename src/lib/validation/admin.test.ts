import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnnouncementSchema } from "@/lib/validation/admin";

afterEach(() => {
  vi.useRealTimers();
});

function parse(expiresAt?: string) {
  return createAnnouncementSchema.safeParse({ title: "Welcome back", message: "Practice starts Monday.", expiresAt });
}

describe("createAnnouncementSchema's end date", () => {
  it("runs through the end of the chosen day in Central time, not to midnight UTC", () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T15:00:00Z") });

    const result = parse("2026-11-05");

    // 23:59:59.999 CST on Nov 5 — choosing today keeps it up all day.
    expect(result.success && result.data.expiresAt?.toISOString()).toBe("2026-11-06T05:59:59.999Z");
  });

  it("still accepts today in the evening, after midnight UTC has already passed", () => {
    // 8pm Central on Nov 5 is 2am Nov 6 UTC.
    vi.useFakeTimers({ now: new Date("2026-11-06T02:00:00Z") });
    expect(parse("2026-11-05").success).toBe(true);
  });

  it("refuses a day that has already ended", () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T15:00:00Z") });

    const result = parse("2026-11-04");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("already passed");
  });

  it("leaves an announcement with no end date open-ended, and refuses something that isn't a date", () => {
    const empty = parse("");
    expect(empty.success && empty.data.expiresAt).toBeUndefined();
    expect(parse("next friday").success).toBe(false);
  });
});
