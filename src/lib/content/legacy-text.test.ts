import { describe, expect, it } from "vitest";
import { splitStoredPassage, stripStepPrefix } from "./legacy-text";

describe("splitStoredPassage", () => {
  it("splits the stem from the passage, word for word", () => {
    const text = "Which choice completes the text?\n\nMicroplastics are common.\n\nA second paragraph.";
    expect(splitStoredPassage(text)).toEqual({
      questionText: "Which choice completes the text?",
      passageText: "Microplastics are common.\n\nA second paragraph.",
    });
    expect(splitStoredPassage('As used in the text, what does the word "mastery" most nearly mean?\n\nThe breezes meet.')?.passageText).toBe(
      "The breezes meet.",
    );
  });

  it("leaves alone a text whose first paragraph isn't a question, or that has one paragraph", () => {
    expect(splitStoredPassage("Microplastics are common.\n\nWhich choice completes the text?")).toBeNull();
    expect(splitStoredPassage("Which choice completes the text?")).toBeNull();
  });
});

describe("stripStepPrefix", () => {
  it("drops a step number the site already shows", () => {
    expect(stripStepPrefix("Step 3: Multiply both sides.")).toBe("Multiply both sides.");
    expect(stripStepPrefix("step 12 - Then simplify.")).toBe("Then simplify.");
    expect(stripStepPrefix("2. Read the table.")).toBe("Read the table.");
  });

  it("keeps a sentence that only starts with a number", () => {
    expect(stripStepPrefix("3.5 is the median.")).toBe("3.5 is the median.");
    expect(stripStepPrefix("12 students answered.")).toBe("12 students answered.");
    expect(stripStepPrefix("$x = 4$ satisfies it.")).toBe("$x = 4$ satisfies it.");
  });
});
