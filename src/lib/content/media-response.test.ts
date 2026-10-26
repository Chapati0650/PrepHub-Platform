import { beforeEach, describe, expect, it, vi } from "vitest";

const readFromStorage = vi.fn();
const getSignedReadUrl = vi.fn();
vi.mock("./storage", () => ({
  readFromStorage: (...args: unknown[]) => readFromStorage(...args),
  getSignedReadUrl: (...args: unknown[]) => getSignedReadUrl(...args),
}));

import { mediaResponse, parseByteRange } from "./media-response";

const NOW = new Date("2026-10-25T14:20:00Z");
const image = { kind: "IMAGE" as const, storageKey: "images/a.png", mimeType: "image/png", sizeBytes: 10 };
const video = { kind: "VIDEO" as const, storageKey: "videos/a.mp4", mimeType: "video/mp4", sizeBytes: 50_000_000 };
const request = (range?: string) => new Request("http://x/api/media/a", { headers: range ? { range } : {} });

describe("parseByteRange", () => {
  it("sends the whole file when there is no usable header", () => {
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("bytes=-", 100)).toBeNull();
    expect(parseByteRange("bytes=0-1,5-9", 100)).toBeNull();
    expect(parseByteRange("items=0-1", 100)).toBeNull();
    expect(parseByteRange("bytes=9-3", 100)).toBeNull();
  });

  it("reads Safari's opening probe", () => {
    expect(parseByteRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1 });
  });

  it("reads an open-ended range to the end of the file", () => {
    expect(parseByteRange("bytes=40-", 100)).toEqual({ start: 40, end: 99 });
  });

  it("clamps an end past the file to its last byte", () => {
    expect(parseByteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
  });

  it("reads a suffix as the last N bytes, all of them if N is larger", () => {
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });

  it("refuses a range that starts past the end or asks for nothing", () => {
    expect(parseByteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 100)).toBe("unsatisfiable");
  });
});

describe("mediaResponse", () => {
  beforeEach(() => {
    readFromStorage.mockReset();
    getSignedReadUrl.mockReset();
  });

  it("redirects a video to its signed URL, cached no longer than the URL lives", async () => {
    getSignedReadUrl.mockResolvedValue({ url: "https://r2.example/v?sig", expiresAt: new Date("2026-10-25T16:00:00Z") });
    const res = await mediaResponse(video, request(), NOW);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://r2.example/v?sig");
    // 100 minutes left, less the 5-minute margin.
    expect(res.headers.get("cache-control")).toBe("private, max-age=5700");
    expect(readFromStorage).not.toHaveBeenCalled();
  });

  it("redirects an image too large to pass through a function", async () => {
    getSignedReadUrl.mockResolvedValue({ url: "https://r2.example/i?sig", expiresAt: new Date("2026-10-25T16:00:00Z") });
    const res = await mediaResponse({ ...image, sizeBytes: 5 * 1024 * 1024 }, request(), NOW);
    expect(res.status).toBe(302);
  });

  it("serves a small image itself, with a cache that never needs to ask again", async () => {
    readFromStorage.mockResolvedValue(Buffer.from("0123456789"));
    const res = await mediaResponse(image, request(), NOW);
    expect(getSignedReadUrl).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("0123456789");
  });

  it("serves a video itself when there is no signed URL (local disk), answering ranges with 206", async () => {
    getSignedReadUrl.mockResolvedValue(null);
    readFromStorage.mockResolvedValue(Buffer.from("0123456789"));
    const res = await mediaResponse({ ...video, sizeBytes: 10 }, request("bytes=0-1"), NOW);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-1/10");
    expect(res.headers.get("content-length")).toBe("2");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("01");
  });

  it("falls back to serving the file when signing fails", async () => {
    getSignedReadUrl.mockRejectedValue(new Error("R2 down"));
    readFromStorage.mockResolvedValue(Buffer.from("0123456789"));
    const res = await mediaResponse({ ...video, sizeBytes: 10 }, request(), NOW);
    expect(res.status).toBe(200);
  });

  it("answers 416 for a range past the end", async () => {
    readFromStorage.mockResolvedValue(Buffer.from("0123456789"));
    const res = await mediaResponse(image, request("bytes=20-"), NOW);
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });

  it("is a 404 when the stored file is missing", async () => {
    readFromStorage.mockRejectedValue(new Error("ENOENT"));
    const res = await mediaResponse(image, request(), NOW);
    expect(res.status).toBe(404);
  });
});
