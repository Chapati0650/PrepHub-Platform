import { describe, expect, it } from "vitest";
import { unsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";

const SECRET = "test-secret";

describe("unsubscribe tokens", () => {
  it("round-trips to the account it was made for", () => {
    const token = unsubscribeToken("user_123", SECRET)!;
    expect(verifyUnsubscribeToken(token, SECRET)).toBe("user_123");
  });

  it("can't be re-pointed at another account", () => {
    const token = unsubscribeToken("user_123", SECRET)!;
    const forged = token.replace("user_123", "user_456");
    expect(verifyUnsubscribeToken(forged, SECRET)).toBeNull();
  });

  it("rejects a token signed with a different secret, or none at all", () => {
    const token = unsubscribeToken("user_123", "other-secret")!;
    expect(verifyUnsubscribeToken(token, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken("user_123", SECRET)).toBeNull();
    expect(verifyUnsubscribeToken("", SECRET)).toBeNull();
  });

  it("makes no link at all without a configured secret", () => {
    expect(unsubscribeToken("user_123", "")).toBeNull();
    expect(verifyUnsubscribeToken("user_123.abc", "")).toBeNull();
  });
});
