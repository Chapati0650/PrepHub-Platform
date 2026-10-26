import { describe, expect, it } from "vitest";
import { sanitizeDraftPatch } from "./draft";

describe("sanitizeDraftPatch", () => {
  it("keeps the two draft fields", () => {
    expect(sanitizeDraftPatch({ draftAnswer: "B", skipped: false })).toEqual({ draftAnswer: "B", skipped: false });
    expect(sanitizeDraftPatch({ draftAnswer: null })).toEqual({ draftAnswer: null });
    expect(sanitizeDraftPatch({ skipped: true })).toEqual({ skipped: true });
  });

  it("drops every field a draft must never write", () => {
    const forged = {
      draftAnswer: "A",
      isCorrect: true,
      answer: "A",
      submittedAt: new Date(),
      finalizedAt: new Date(),
      waivedAt: null,
      questionRevisionId: "other-revision",
      practiceSetId: "someone-elses-set",
    };
    expect(sanitizeDraftPatch(forged)).toEqual({ draftAnswer: "A" });
  });

  it("ignores fields of the wrong type", () => {
    expect(sanitizeDraftPatch({ draftAnswer: 42, skipped: "yes" })).toEqual({});
  });

  it("treats a non-object as an empty patch", () => {
    expect(sanitizeDraftPatch(null)).toEqual({});
    expect(sanitizeDraftPatch("draftAnswer")).toEqual({});
    expect(sanitizeDraftPatch(undefined)).toEqual({});
  });

  it("caps an absurdly long draft", () => {
    expect(sanitizeDraftPatch({ draftAnswer: "9".repeat(10_000) }).draftAnswer).toHaveLength(200);
  });
});
