import { describe, expect, it } from "vitest";
import { extractApiErrorMessage } from "./api-error-message";

describe("extractApiErrorMessage", () => {
  it("extracts a directly-nested message (OpenAI/DeepSeek shape)", () => {
    const err = { error: { message: "Insufficient balance.", type: "insufficient_quota" } };
    expect(extractApiErrorMessage(err)).toBe("Insufficient balance.");
  });

  it("extracts a doubly-nested message (Anthropic shape)", () => {
    const err = {
      error: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low." } },
    };
    expect(extractApiErrorMessage(err)).toBe("Your credit balance is too low.");
  });

  it("prefers the direct message over a nested one when both exist", () => {
    const err = { error: { message: "direct", error: { message: "nested" } } };
    expect(extractApiErrorMessage(err)).toBe("direct");
  });

  it("trims whitespace", () => {
    const err = { error: { message: "  spaced out  " } };
    expect(extractApiErrorMessage(err)).toBe("spaced out");
  });

  it("returns null for a plain Error with no .error property", () => {
    expect(extractApiErrorMessage(new Error("network blip"))).toBeNull();
  });

  it("returns null for a non-object input", () => {
    expect(extractApiErrorMessage("just a string")).toBeNull();
    expect(extractApiErrorMessage(null)).toBeNull();
    expect(extractApiErrorMessage(undefined)).toBeNull();
  });

  it("returns null when .error exists but has no usable message", () => {
    expect(extractApiErrorMessage({ error: { type: "overloaded_error" } })).toBeNull();
    expect(extractApiErrorMessage({ error: "not an object" })).toBeNull();
    expect(extractApiErrorMessage({ error: { message: "   " } })).toBeNull();
  });
});
