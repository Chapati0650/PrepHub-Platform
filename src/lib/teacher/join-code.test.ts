import { describe, expect, it } from "vitest";
import { formatJoinCode, generateJoinCode, JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, joinShareText, joinSiteLabel, normalizeJoinCode } from "@/lib/teacher/join-code";

describe("join codes", () => {
  it("are six characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      for (const ch of code) expect(JOIN_CODE_ALPHABET).toContain(ch);
    }
  });

  it("leave out everything that's misread off a projector", () => {
    for (const ch of "0O1IL5S2Z8B") expect(JOIN_CODE_ALPHABET).not.toContain(ch);
  });

  it("are built from the injected source, so a collision retry is testable", () => {
    expect(generateJoinCode(() => 0)).toBe("AAAAAA");
  });

  it("accept what a student actually types", () => {
    expect(normalizeJoinCode(" acd-efg ")).toBe("ACDEFG");
    expect(normalizeJoinCode("ACD EFG")).toBe("ACDEFG");
  });

  it("reject anything that can't be a code", () => {
    expect(normalizeJoinCode("ACDEF")).toBeNull();
    expect(normalizeJoinCode("ACDEFGH")).toBeNull();
    expect(normalizeJoinCode("ACDEF0")).toBeNull();
    expect(normalizeJoinCode("")).toBeNull();
  });

  it("are shown in two halves", () => {
    expect(formatJoinCode("ACDEFG")).toBe("ACD-EFG");
  });
});

describe("join sharing helpers", () => {
  it("joinSiteLabel drops the scheme and trailing slashes", () => {
    expect(joinSiteLabel("https://prephub.example/")).toBe("prephub.example");
    expect(joinSiteLabel("http://localhost:3000")).toBe("localhost:3000");
  });

  it("joinShareText names the class, the dashed code and the link with the bare code", () => {
    const text = joinShareText("3rd period", "ACDEFG", "https://prephub.example/");
    expect(text).toContain("Join 3rd period on PrepHub");
    expect(text).toContain("Go to prephub.example and sign in");
    expect(text).toContain("class code ACD-EFG");
    expect(text).toContain("https://prephub.example/join/ACDEFG");
    expect(joinShareText("x", "ACD-EFG", "https://a.b")).toContain("https://a.b/join/ACDEFG");
  });
});
