import { describe, expect, it } from "vitest";
import { isImageEntry } from "./extract-zip-images";

describe("isImageEntry", () => {
  it.each(["question1.png", "photo.JPG", "img.jpeg", "graph.webp", "folder/question2.png"])(
    "accepts %s",
    (path) => {
      expect(isImageEntry(path)).toBe(true);
    },
  );

  it.each([
    ".DS_Store",
    "__MACOSX/question1.png",
    "notes.txt",
    "question.pdf",
    "folder/.hidden.png",
    "noextension",
  ])("rejects %s", (path) => {
    expect(isImageEntry(path)).toBe(false);
  });
});
