import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("keeps a path on this site, query included", () => {
    expect(safeNextPath("/homework/abc123")).toBe("/homework/abc123");
    expect(safeNextPath("/settings#notifications")).toBe("/settings#notifications");
    expect(safeNextPath("/home?view=student")).toBe("/home?view=student");
  });

  it("refuses anything that could leave the site", () => {
    for (const raw of ["//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "javascript:alert(1)", "/home\\..\\x"]) {
      expect(safeNextPath(raw)).toBeNull();
    }
  });

  it("refuses the auth pages, so signing in can't loop", () => {
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/signup?x=1")).toBeNull();
    expect(safeNextPath("/api/auth/signout")).toBeNull();
    expect(safeNextPath("/reset-password/abc")).toBeNull();
  });

  it("refuses non-strings, empty and absurdly long values", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath(`/${"a".repeat(600)}`)).toBeNull();
  });
});
