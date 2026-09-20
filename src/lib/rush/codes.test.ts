import { describe, it, expect } from "vitest";
import { createRandom } from "@/lib/adaptive/random";
import { RUSH_CODE_ALPHABET, generateRushCode, normalizeRushCode } from "./codes";

describe("generateRushCode", () => {
  it("makes six characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRushCode(createRandom(`s${i}`));
      expect(code).toHaveLength(6);
      for (const ch of code) expect(RUSH_CODE_ALPHABET).toContain(ch);
    }
  });
  it("never emits a look-alike character", () => {
    expect(RUSH_CODE_ALPHABET).not.toMatch(/[0O1I]/);
  });
});

describe("normalizeRushCode", () => {
  it("accepts lowercase, spaces and dashes", () => {
    expect(normalizeRushCode("abc 234")).toBe("ABC234");
    expect(normalizeRushCode("abc-234")).toBe("ABC234");
    expect(normalizeRushCode(" ABC234 ")).toBe("ABC234");
  });
  it("rejects the wrong length or characters outside the alphabet", () => {
    expect(normalizeRushCode("ABC23")).toBeNull();
    expect(normalizeRushCode("ABC2345")).toBeNull();
    expect(normalizeRushCode("ABC01O")).toBeNull();
    expect(normalizeRushCode("")).toBeNull();
  });
});
