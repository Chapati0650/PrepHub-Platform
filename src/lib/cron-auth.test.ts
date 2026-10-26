import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "./cron-auth";

const request = (authorization?: string) =>
  new Request("https://example.test/api/cron/daily", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });

describe("isCronAuthorized", () => {
  it("admits the configured bearer secret", () => {
    expect(isCronAuthorized(request("Bearer s3cret"), "s3cret")).toBe(true);
  });

  it("refuses a wrong, partial or missing secret", () => {
    expect(isCronAuthorized(request("Bearer s3cre"), "s3cret")).toBe(false);
    expect(isCronAuthorized(request("s3cret"), "s3cret")).toBe(false);
    expect(isCronAuthorized(request(), "s3cret")).toBe(false);
  });

  it("stays shut when no secret is configured", () => {
    expect(isCronAuthorized(request("Bearer "), "")).toBe(false);
    expect(isCronAuthorized(request("Bearer undefined"), undefined)).toBe(false);
  });
});
