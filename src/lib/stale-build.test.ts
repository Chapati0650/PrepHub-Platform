import { describe, it, expect } from "vitest";
import { isStaleServerActionError } from "./stale-build";

describe("isStaleServerActionError", () => {
  it("recognizes Next's stale-action error, as thrown in production", () => {
    expect(
      isStaleServerActionError(
        new Error(
          'Server Action "4058909f40541e9f22706984f5413ed0a3366793d1" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action',
        ),
      ),
    ).toBe(true);
  });

  it("recognizes the documented short form and a bare string", () => {
    expect(isStaleServerActionError(new Error("Failed to find Server Action x"))).toBe(true);
    expect(isStaleServerActionError("Failed to find Server Action x")).toBe(true);
  });

  it("does not match ordinary failures", () => {
    expect(isStaleServerActionError(new Error("Network request failed"))).toBe(false);
    expect(isStaleServerActionError(new Error("Not authorized."))).toBe(false);
    expect(isStaleServerActionError(null)).toBe(false);
    expect(isStaleServerActionError(undefined)).toBe(false);
  });
});
