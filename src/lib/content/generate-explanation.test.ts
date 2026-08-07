import { describe, expect, it } from "vitest";
import { collectGeneratedFileIds, extractJsonBlock } from "./generate-explanation";
import type Anthropic from "@anthropic-ai/sdk";

describe("extractJsonBlock", () => {
  it("parses a fenced ```json block", () => {
    const text = 'Here is the result:\n```json\n{"steps": [{"text": "a", "imageFile": null}]}\n```';
    expect(extractJsonBlock(text)).toEqual({ steps: [{ text: "a", imageFile: null }] });
  });

  it("parses a bare fenced block with no language tag", () => {
    const text = '```\n{"steps": []}\n```';
    expect(extractJsonBlock(text)).toEqual({ steps: [] });
  });

  it("falls back to parsing the whole text when there is no fence", () => {
    const text = '{"steps": [{"text": "b", "imageFile": "step_1.png"}]}';
    expect(extractJsonBlock(text)).toEqual({ steps: [{ text: "b", imageFile: "step_1.png" }] });
  });

  it("throws on unparseable content", () => {
    expect(() => extractJsonBlock("not json at all")).toThrow();
  });
});

describe("collectGeneratedFileIds", () => {
  it("returns an empty array when there are no code-execution results", () => {
    const content = [{ type: "text", text: "hello" }] as unknown as Anthropic.Messages.ContentBlock[];
    expect(collectGeneratedFileIds(content)).toEqual([]);
  });

  it("collects file ids from bash_code_execution_output entries", () => {
    const content = [
      {
        type: "bash_code_execution_tool_result",
        content: {
          type: "bash_code_execution_result",
          content: [
            { type: "bash_code_execution_output", file_id: "file_abc" },
            { type: "bash_code_execution_output", file_id: "file_def" },
          ],
        },
      },
    ] as unknown as Anthropic.Messages.ContentBlock[];
    expect(collectGeneratedFileIds(content)).toEqual(["file_abc", "file_def"]);
  });

  it("collects across multiple code-execution result blocks", () => {
    const content = [
      {
        type: "bash_code_execution_tool_result",
        content: {
          type: "bash_code_execution_result",
          content: [{ type: "bash_code_execution_output", file_id: "file_1" }],
        },
      },
      { type: "text", text: "some narration in between" },
      {
        type: "bash_code_execution_tool_result",
        content: {
          type: "bash_code_execution_result",
          content: [{ type: "bash_code_execution_output", file_id: "file_2" }],
        },
      },
    ] as unknown as Anthropic.Messages.ContentBlock[];
    expect(collectGeneratedFileIds(content)).toEqual(["file_1", "file_2"]);
  });

  it("ignores code-execution results with no file output (e.g. plain stdout)", () => {
    const content = [
      {
        type: "bash_code_execution_tool_result",
        content: {
          type: "bash_code_execution_result",
          content: [{ type: "bash_code_execution_stdout", stdout: "42\n" }],
        },
      },
    ] as unknown as Anthropic.Messages.ContentBlock[];
    expect(collectGeneratedFileIds(content)).toEqual([]);
  });

  it("ignores an errored code-execution result", () => {
    const content = [
      { type: "bash_code_execution_tool_result", content: { type: "bash_code_execution_tool_result_error" } },
    ] as unknown as Anthropic.Messages.ContentBlock[];
    expect(collectGeneratedFileIds(content)).toEqual([]);
  });
});
