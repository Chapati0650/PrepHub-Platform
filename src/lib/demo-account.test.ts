import { describe, expect, it } from "vitest";
import { isDemoAccount } from "./demo-account";

describe("isDemoAccount", () => {
  it("recognizes example.com and its subdomains, any case", () => {
    expect(isDemoAccount("hisd.student@example.com")).toBe(true);
    expect(isDemoAccount("a@demo-isd.example.com")).toBe(true);
    expect(isDemoAccount("A@Example.COM")).toBe(true);
  });
  it("rejects real domains, lookalikes and missing values", () => {
    expect(isDemoAccount("a@gmail.com")).toBe(false);
    expect(isDemoAccount("a@notexample.com")).toBe(false);
    expect(isDemoAccount("a@example.com.evil.org")).toBe(false);
    expect(isDemoAccount("example.com")).toBe(false);
    expect(isDemoAccount("")).toBe(false);
    expect(isDemoAccount(null)).toBe(false);
    expect(isDemoAccount(undefined)).toBe(false);
  });
});
