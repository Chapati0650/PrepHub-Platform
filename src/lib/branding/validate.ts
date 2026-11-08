import { normalizeHexColor } from "./colors";

export const BRAND_NAME_MAX = 60;

export type BrandingInput = { brandName: string | null; brandColor: string | null };

/** Validates the Owner form's text fields. Empty means "not set". */
export function parseBrandingInput(rawName: unknown, rawColor: unknown): { value: BrandingInput } | { error: string } {
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  if (name.length > BRAND_NAME_MAX) return { error: `The display name can be at most ${BRAND_NAME_MAX} characters.` };
  if (/[<>]/.test(name)) return { error: "The display name can't contain < or >." };
  const colorText = typeof rawColor === "string" ? rawColor.trim() : "";
  let color: string | null = null;
  if (colorText) {
    color = normalizeHexColor(colorText);
    if (!color) return { error: "Use a hex color such as #BA0C2F." };
  }
  return { value: { brandName: name || null, brandColor: color } };
}
