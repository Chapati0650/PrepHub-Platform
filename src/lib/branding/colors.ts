/**
 * Brand-color helpers for district/school co-branding (2026-11-08).
 *
 * A brand color is an accent only. Text that sits on it is computed here, and
 * if the pair would fail WCAG AA the caller gets `null` and uses PrepHub's own
 * palette instead. Pure functions, no I/O.
 */

/** WCAG 2.x AA for normal-size text. */
export const AA_TEXT_RATIO = 4.5;
/** A chip the same shade as the page it sits on is invisible; below this it is dropped. */
export const MIN_ACCENT_VISIBILITY_RATIO = 1.2;

const HEX6 = /^#[0-9A-F]{6}$/;

/**
 * "#0a5", "0A5", "#00AA55" all become "#00AA55". Anything else (names, rgb(),
 * alpha channels, the wrong length) is null, so what is stored is always a
 * plain 6-digit uppercase hex.
 */
export function normalizeHexColor(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  let v = input.trim().toUpperCase();
  if (v.startsWith("#")) v = v.slice(1);
  if (/^[0-9A-F]{3}$/.test(v)) v = v.replace(/./g, (c) => c + c);
  const out = `#${v}`;
  return HEX6.test(out) ? out : null;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a normalized #RRGGBB color. */
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio, 1 to 21, between two normalized colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const LIGHT_TEXT = "#FFFFFF";
export const DARK_TEXT = "#000000";

/** Whichever of white or near-black reads better on `hex`. */
export function readableTextOn(hex: string): string {
  return contrastRatio(hex, LIGHT_TEXT) >= contrastRatio(hex, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

export type BrandAccent = { color: string; textColor: string };

/**
 * The brand color plus the text color to put on it, or null when the pair
 * can't be used: invalid input, text that wouldn't reach AA, or a color so
 * close to white that a chip made of it would vanish on the page.
 */
export function safeBrandAccent(raw: string | null | undefined): BrandAccent | null {
  const color = normalizeHexColor(raw);
  if (!color) return null;
  const textColor = readableTextOn(color);
  if (contrastRatio(color, textColor) < AA_TEXT_RATIO) return null;
  if (contrastRatio(color, "#FFFFFF") < MIN_ACCENT_VISIBILITY_RATIO) return null;
  return { color, textColor };
}
