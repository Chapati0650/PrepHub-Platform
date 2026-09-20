import { describe, it, expect } from "vitest";
import { getBulkUploadReadiness } from "./ai-readiness";

describe("getBulkUploadReadiness", () => {
  it("is ready only when both provider keys are present", () => {
    expect(getBulkUploadReadiness({ ANTHROPIC_API_KEY: "a", DEEPSEEK_API_KEY: "d" })).toEqual({ ready: true });
  });

  it("names the missing DeepSeek key and promises nothing was spent", () => {
    const r = getBulkUploadReadiness({ ANTHROPIC_API_KEY: "a" });
    expect(r.ready).toBe(false);
    if (r.ready) return;
    expect(r.missing.map((m) => m.envVar)).toEqual(["DEEPSEEK_API_KEY"]);
    expect(r.message).toContain("DEEPSEEK_API_KEY");
    expect(r.message).not.toContain("ANTHROPIC_API_KEY");
    expect(r.message).toContain("cost nothing");
  });

  it("names both when both are missing, and treats blank as missing", () => {
    const r = getBulkUploadReadiness({ ANTHROPIC_API_KEY: "  ", DEEPSEEK_API_KEY: "" });
    expect(r.ready).toBe(false);
    if (r.ready) return;
    expect(r.missing.map((m) => m.envVar)).toEqual(["ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"]);
    expect(r.message).toContain("aren't set");
  });
});
