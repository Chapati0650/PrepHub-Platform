import { describe, expect, it } from "vitest";
import { z } from "zod";
import { completeWithJson, sanitizeJsonEscapes } from "./deepseek-client";
import type OpenAI from "openai";

const Schema = z.object({ text: z.string() });

describe("sanitizeJsonEscapes", () => {
  it("leaves already-valid escapes untouched", () => {
    // \n is deliberately NOT in the preserved set, matching the
    // implementation's comment: only \\, \", \/, and \uXXXX are assumed
    // legitimate, since \n also collides with the LaTeX command \nu.
    const input = String.raw`"a \\ b \" c \/ d é f"`;
    expect(sanitizeJsonEscapes(input)).toBe(input);
  });

  it("fixes an unescaped LaTeX backslash that collides with a JSON escape letter", () => {
    // \f collides with the JSON form-feed escape — this is the exact bug
    // confirmed via a real generated distractor note losing its \frac.
    const input = String.raw`"$-\frac{k+\frac{3}{4}}{4} < 0$"`;
    expect(JSON.parse(sanitizeJsonEscapes(input))).toBe("$-\\frac{k+\\frac{3}{4}}{4} < 0$");
  });

  it.each([
    ["\\left", "left"],
    ["\\right", "right"],
    ["\\cdot", "cdot"],
    ["\\times", "times"],
    ["\\theta", "theta"],
    ["\\boxed", "boxed"],
  ])("fixes unescaped %s", (command) => {
    const input = `"${command}"`;
    expect(JSON.parse(sanitizeJsonEscapes(input))).toBe(command);
  });

  it("doesn't double-escape an already-correctly-escaped backslash", () => {
    const input = String.raw`"\\frac{1}{2}"`; // raw JSON text: \\frac{1}{2}
    expect(JSON.parse(sanitizeJsonEscapes(input))).toBe("\\frac{1}{2}");
  });

  it("preserves a real unicode escape", () => {
    const input = String.raw`"café"`;
    expect(JSON.parse(sanitizeJsonEscapes(input))).toBe("café");
  });
});

function fakeClient(content: string | null, finishReason = "stop"): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ finish_reason: finishReason, message: { content } }],
        }),
      },
    },
  } as unknown as OpenAI;
}

describe("completeWithJson", () => {
  it("parses and validates a well-formed JSON response", async () => {
    const client = fakeClient('{"text": "hello"}');
    const result = await completeWithJson(client, { model: "deepseek-v4-pro", prompt: "p", schema: Schema });
    expect(result).toEqual({ text: "hello" });
  });

  it("repairs unescaped LaTeX backslashes end-to-end instead of corrupting or throwing", async () => {
    // Simulates DeepSeek's raw (buggy) response: a real \frac left un-doubled.
    const client = fakeClient(String.raw`{"text": "$-\frac{k+\frac{3}{4}}{4} < 0$"}`);
    const result = await completeWithJson(client, { model: "deepseek-v4-pro", prompt: "p", schema: Schema });
    expect(result).toEqual({ text: "$-\\frac{k+\\frac{3}{4}}{4} < 0$" });
  });

  it("throws when the response doesn't match the schema", async () => {
    const client = fakeClient('{"wrong": 1}');
    await expect(
      completeWithJson(client, { model: "deepseek-v4-pro", prompt: "p", schema: Schema }),
    ).rejects.toThrow();
  });

  it("throws on unparseable content", async () => {
    const client = fakeClient("not json");
    await expect(
      completeWithJson(client, { model: "deepseek-v4-pro", prompt: "p", schema: Schema }),
    ).rejects.toThrow();
  });

  it("throws on empty content", async () => {
    const client = fakeClient(null);
    await expect(
      completeWithJson(client, { model: "deepseek-v4-pro", prompt: "p", schema: Schema }),
    ).rejects.toThrow("empty response");
  });

  it("throws when the response is refused by safety classifiers", async () => {
    const client = fakeClient('{"text": "hello"}', "content_filter");
    await expect(
      completeWithJson(client, { model: "deepseek-v4-pro", prompt: "p", schema: Schema }),
    ).rejects.toThrow("refused");
  });
});
