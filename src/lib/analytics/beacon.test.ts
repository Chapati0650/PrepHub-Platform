import { describe, expect, it } from "vitest";
import { beaconPath } from "./beacon";

describe("beaconPath", () => {
  it.each(["/", "/login", "/signup", "/schools", "/pricing", "/reset-password"])("accepts %s, a page that sends the beacon", (path) => {
    expect(beaconPath(path)).toBe(path);
  });

  it("never stores a password-reset token", () => {
    expect(beaconPath("/reset-password/3f9c2b7e-live-token")).toBe("/reset-password/[token]");
  });

  it("treats a trailing slash or a stray query as the same page", () => {
    expect(beaconPath("/signup/")).toBe("/signup");
    expect(beaconPath("/pricing?ref=abc")).toBe("/pricing");
  });

  it.each([["/home"], ["/owner/content"], ["/reset-password/a/b"], ["javascript:alert(1)"], [""], [42], [null]])(
    "drops %s, which no public page sends",
    (path) => {
      expect(beaconPath(path)).toBeNull();
    },
  );
});
