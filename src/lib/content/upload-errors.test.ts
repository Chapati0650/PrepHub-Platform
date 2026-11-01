import { describe, expect, it } from "vitest";
import { HOST_UPLOAD_LIMIT_BYTES, actionFailureMessage, uploadFailureMessage } from "./upload-errors";
import { STALE_BUILD_MESSAGE } from "@/lib/stale-build";

const stale = new Error('Server Action "abc123" was not found on the server.');
const MB = 1024 * 1024;

describe("actionFailureMessage", () => {
  it("asks for a reload when a deploy rotated the action away", () => {
    expect(actionFailureMessage(stale)).toBe(STALE_BUILD_MESSAGE);
  });

  it("falls back to the caller's message for anything else", () => {
    expect(actionFailureMessage(new TypeError("Failed to fetch"), "Couldn't generate.")).toBe("Couldn't generate.");
  });
});

describe("uploadFailureMessage", () => {
  it("asks for a reload for a stale action, even for a large file", () => {
    expect(uploadFailureMessage(stale, 50 * MB)).toBe(STALE_BUILD_MESSAGE);
  });

  it("names the size when the server says the body was too large", () => {
    const message = uploadFailureMessage(new Error("Body exceeded 12mb limit"), 2 * MB);
    expect(message).toMatch(/2\.0 MB, which is too large/);
  });

  it("names the size when the host gave no reason but the file is over what it accepts", () => {
    const message = uploadFailureMessage(new Error("An unexpected response was received from the server."), 8 * MB);
    expect(message).toMatch(/8\.0 MB.*too large to upload through this host/);
  });

  it("blames the connection, not the file, for a small file", () => {
    expect(uploadFailureMessage(new TypeError("Failed to fetch"), HOST_UPLOAD_LIMIT_BYTES - 1)).toMatch(/connection/);
  });
});
