import { describe, expect, it } from "vitest";
import { contrastRatio, normalizeHexColor, readableTextOn, relativeLuminance, safeBrandAccent } from "./colors";
import { parseBrandingInput } from "./validate";

describe("normalizeHexColor", () => {
  it("accepts 6 and 3 digit hex, with or without #, any case", () => {
    expect(normalizeHexColor("#ba0c2f")).toBe("#BA0C2F");
    expect(normalizeHexColor("ba0c2f")).toBe("#BA0C2F");
    expect(normalizeHexColor(" #0a5 ")).toBe("#00AA55");
  });
  it("rejects everything else", () => {
    for (const bad of ["", "red", "#12", "#12345", "#1234567", "#GGGGGG", "rgb(1,2,3)", "#12345678", null, undefined]) {
      expect(normalizeHexColor(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe("contrast", () => {
  it("matches known WCAG values", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 3);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });
  it("picks white on dark and near-black on light", () => {
    expect(readableTextOn("#00205B")).toBe("#FFFFFF");
    expect(readableTextOn("#FFD100")).toBe("#000000");
  });
  it("always reaches AA for the chosen text color across a sweep", () => {
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 51) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
          expect(contrastRatio(hex, readableTextOn(hex))).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe("safeBrandAccent", () => {
  it("returns the color and an AA-safe text color", () => {
    expect(safeBrandAccent("#ba0c2f")).toEqual({ color: "#BA0C2F", textColor: "#FFFFFF" });
    expect(safeBrandAccent("#FFD100")).toEqual({ color: "#FFD100", textColor: "#000000" });
  });
  it("falls back (null) for invalid, missing or near-white colors", () => {
    expect(safeBrandAccent("nope")).toBeNull();
    expect(safeBrandAccent(null)).toBeNull();
    expect(safeBrandAccent("#FEFEFE")).toBeNull();
    expect(safeBrandAccent("#FFFFFF")).toBeNull();
  });
});

describe("parseBrandingInput", () => {
  it("treats empty as not set and normalizes the color", () => {
    expect(parseBrandingInput("  ", "")).toEqual({ value: { brandName: null, brandColor: null } });
    expect(parseBrandingInput(" Houston  ISD ", "#00205b")).toEqual({
      value: { brandName: "Houston ISD", brandColor: "#00205B" },
    });
  });
  it("rejects a bad color, an over-long name and angle brackets", () => {
    expect(parseBrandingInput("", "blue")).toHaveProperty("error");
    expect(parseBrandingInput("x".repeat(61), "")).toHaveProperty("error");
    expect(parseBrandingInput("<b>", "")).toHaveProperty("error");
  });
});
