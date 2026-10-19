import { describe, expect, it } from "vitest";
import { isLosslessSplit, splitPassageAndQuestion } from "./split-passage";

const PASSAGE =
  "Although critics believed that customers would never agree to pay to pick their own produce on farms, such concerns did not ______ Booker T. Whatley's efforts to promote the practice. Thanks in part to Whatley's determined advocacy, farms that allow visitors to pick their own apples, pumpkins, and other produce can be found throughout the United States.";

describe("splitPassageAndQuestion", () => {
  it("splits a passage from a 'Which choice' stem", () => {
    const text = `${PASSAGE}\n\nWhich choice completes the text with the most logical and precise word or phrase?`;
    const split = splitPassageAndQuestion(text);
    expect(split).not.toBeNull();
    expect(split!.passage).toBe(PASSAGE);
    expect(split!.question).toBe(
      "Which choice completes the text with the most logical and precise word or phrase?",
    );
  });

  it("produces a lossless split", () => {
    const text = `${PASSAGE}\n\nWhich choice completes the text with the most logical and precise word or phrase?`;
    expect(isLosslessSplit(text, splitPassageAndQuestion(text)!)).toBe(true);
  });

  it("keeps multi-paragraph passages together", () => {
    const text = `First paragraph of the passage goes here and is reasonably long.\n\nSecond paragraph of the passage continues the same idea at length.\n\nBased on the text, what can be concluded?`;
    const split = splitPassageAndQuestion(text);
    expect(split!.passage).toContain("First paragraph");
    expect(split!.passage).toContain("Second paragraph");
    expect(split!.question).toBe("Based on the text, what can be concluded?");
  });

  it("returns null when there is only one block", () => {
    expect(splitPassageAndQuestion("What is 2 + 2?")).toBeNull();
  });

  it("returns null when the final block is not a question stem", () => {
    const text = `${PASSAGE}\n\nAnother ordinary paragraph that simply continues the passage without asking anything at all.`;
    expect(splitPassageAndQuestion(text)).toBeNull();
  });

  it("returns null when the supposed passage is shorter than the stem", () => {
    // A short lead-in followed by a long question is a question, not a passage.
    const text = `Note.\n\nWhich choice best describes the overall structure of the text as presented across the whole of the preceding discussion and its several competing claims?`;
    expect(splitPassageAndQuestion(text)).toBeNull();
  });

  it("accepts a short final block ending in a question mark", () => {
    const text = `${PASSAGE}\n\nWhat is the main purpose of the text?`;
    expect(splitPassageAndQuestion(text)!.question).toBe("What is the main purpose of the text?");
  });

  it("does not treat a long trailing paragraph ending in '?' as a stem", () => {
    const longTrailer = `${"Why would anyone think that ".repeat(15)}?`;
    const text = `${PASSAGE}\n\n${longTrailer}`;
    expect(splitPassageAndQuestion(text)).toBeNull();
  });

  it("handles Windows line endings", () => {
    const text = `${PASSAGE}\r\n\r\nWhich choice completes the text?`;
    const split = splitPassageAndQuestion(text);
    expect(split).not.toBeNull();
    expect(split!.question).toBe("Which choice completes the text?");
  });

  it("is case insensitive about stem openers", () => {
    const text = `${PASSAGE}\n\nWHICH CHOICE completes the text?`;
    expect(splitPassageAndQuestion(text)).not.toBeNull();
  });
});

describe("isLosslessSplit", () => {
  it("rejects a split that dropped content", () => {
    const original = `${PASSAGE}\n\nWhich choice completes the text?`;
    expect(isLosslessSplit(original, { passage: "truncated", question: "Which choice?" })).toBe(false);
  });

  it("tolerates whitespace-only differences", () => {
    const original = `line one\n\n\n   Which choice completes the text?   `;
    expect(
      isLosslessSplit(original, { passage: "line one", question: "Which choice completes the text?" }),
    ).toBe(true);
  });
});
