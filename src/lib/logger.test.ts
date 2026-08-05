import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  logEvent,
  logAuthFailure,
  logUnauthorizedAccess,
  logRateLimitExceeded,
  logPaymentFailure,
  logEmailDeliveryFailure,
} from "@/lib/logger";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

function lastLoggedEntry(): Record<string, unknown> {
  const raw = consoleErrorSpy.mock.calls.at(-1)?.[0];
  return JSON.parse(raw as string);
}

describe("logEvent", () => {
  it("writes a single structured JSON line with timestamp, environment, and category", () => {
    logEvent("SERVER_ERROR", "Something broke", { affectedResourceId: "res_1" });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const entry = lastLoggedEntry();
    expect(entry.category).toBe("SERVER_ERROR");
    expect(entry.message).toBe("Something broke");
    expect(entry.affectedResourceId).toBe("res_1");
    expect(typeof entry.timestamp).toBe("string");
    expect(typeof entry.environment).toBe("string");
  });

  it("redacts context values whose key name looks sensitive, regardless of what the caller passes", () => {
    logEvent("AUTH_FAILURE", "bad login", {
      password: "hunter2222",
      token: "abc123",
      sessionCookie: "value",
      accountId: "u1",
    });

    const entry = lastLoggedEntry();
    expect(entry.password).toBe("[redacted]");
    expect(entry.token).toBe("[redacted]");
    expect(entry.sessionCookie).toBe("[redacted]");
    expect(entry.accountId).toBe("u1");
  });

  it("never throws even when passed circular-unsafe values would be a concern — plain values only", () => {
    expect(() => logEvent("SERVER_ERROR", "ok", { affectedResourceId: "x" })).not.toThrow();
  });
});

describe("category convenience wrappers", () => {
  it("logAuthFailure tags AUTH_FAILURE", () => {
    logAuthFailure("bad password", { email: "student@example.com" });
    expect(lastLoggedEntry().category).toBe("AUTH_FAILURE");
  });

  it("logUnauthorizedAccess tags UNAUTHORIZED_ACCESS", () => {
    logUnauthorizedAccess("role mismatch", { accountId: "u1" });
    expect(lastLoggedEntry().category).toBe("UNAUTHORIZED_ACCESS");
  });

  it("logRateLimitExceeded tags RATE_LIMIT_EXCEEDED", () => {
    logRateLimitExceeded("too many attempts");
    expect(lastLoggedEntry().category).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("logPaymentFailure tags PAYMENT_WEBHOOK_FAILURE", () => {
    logPaymentFailure("webhook failed");
    expect(lastLoggedEntry().category).toBe("PAYMENT_WEBHOOK_FAILURE");
  });

  it("logEmailDeliveryFailure tags EMAIL_DELIVERY_FAILURE", () => {
    logEmailDeliveryFailure("send failed");
    expect(lastLoggedEntry().category).toBe("EMAIL_DELIVERY_FAILURE");
  });
});
