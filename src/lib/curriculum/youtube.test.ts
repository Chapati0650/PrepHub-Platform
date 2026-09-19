import { describe, it, expect } from "vitest";
import { parseYouTubeVideoId, youTubeEmbedUrl } from "./youtube";

describe("parseYouTubeVideoId", () => {
  const id = "dQw4w9WgXcQ";

  it.each([
    ["bare id", id],
    ["watch URL", `https://www.youtube.com/watch?v=${id}`],
    ["watch URL with extra params", `https://www.youtube.com/watch?v=${id}&t=42s&list=PLxyz`],
    ["share link", `https://youtu.be/${id}`],
    ["share link with timestamp", `https://youtu.be/${id}?t=10`],
    ["shorts", `https://www.youtube.com/shorts/${id}`],
    ["embed", `https://www.youtube.com/embed/${id}`],
    ["nocookie embed", `https://www.youtube-nocookie.com/embed/${id}`],
    ["mobile", `https://m.youtube.com/watch?v=${id}`],
    ["no scheme", `youtube.com/watch?v=${id}`],
    ["surrounding whitespace", `  https://youtu.be/${id}  `],
  ])("extracts the id from a %s", (_label, input) => {
    expect(parseYouTubeVideoId(input)).toBe(id);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["another site", "https://vimeo.com/123456"],
    ["youtube but no id", "https://www.youtube.com/"],
    ["youtube channel page", "https://www.youtube.com/@PrepHub"],
    ["malformed id length", "https://youtu.be/tooshort"],
    ["garbage", "not a url at all !!"],
  ])("returns null for %s", (_label, input) => {
    expect(parseYouTubeVideoId(input)).toBeNull();
  });
});

describe("youTubeEmbedUrl", () => {
  it("uses the privacy-enhanced host and disables unrelated suggestions", () => {
    const url = youTubeEmbedUrl("dQw4w9WgXcQ");
    expect(url.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe(true);
    expect(url).toContain("rel=0");
  });
});
