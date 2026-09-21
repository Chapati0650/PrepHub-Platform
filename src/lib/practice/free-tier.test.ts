import { describe, it, expect, vi, beforeEach } from "vitest";
import { canOpenPracticeSet, isFreePracticeSet, FREE_PRACTICE_SETS } from "./free-tier";
import { hasPaidAccess } from "@/lib/entitlements";

vi.mock("@/lib/entitlements", () => ({ hasPaidAccess: vi.fn() }));
const mockedPaid = hasPaidAccess as ReturnType<typeof vi.fn>;

describe("free tier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Set 1 is free; Set 2 is not", () => {
    expect(FREE_PRACTICE_SETS).toBe(1);
    expect(isFreePracticeSet(1)).toBe(true);
    expect(isFreePracticeSet(2)).toBe(false);
  });

  it("opens a free set without consulting entitlements", async () => {
    expect(await canOpenPracticeSet("s1", 1)).toBe(true);
    expect(mockedPaid).not.toHaveBeenCalled();
  });

  it("defers to hasPaidAccess for every later set", async () => {
    mockedPaid.mockResolvedValueOnce(false);
    expect(await canOpenPracticeSet("s1", 2)).toBe(false);
    mockedPaid.mockResolvedValueOnce(true);
    expect(await canOpenPracticeSet("s1", 7)).toBe(true);
    expect(mockedPaid).toHaveBeenCalledTimes(2);
  });
});
