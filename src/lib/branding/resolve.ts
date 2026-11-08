import { safeBrandAccent } from "./colors";

/** The branding columns of an Organization row. */
export type BrandingSource = {
  officialName: string;
  logoMediaId: string | null;
  brandName: string | null;
  brandColor: string | null;
} | null;

/** What the app shell and dashboard receive. Always safe to render as-is. */
export type OrganizationBranding = {
  /** Display name: brandName, else the legal name. */
  name: string;
  logoMediaId: string | null;
  /** Validated accent and its AA-safe text color; null means use PrepHub's palette. */
  accent: { color: string; textColor: string } | null;
  /** True when the campus had none of its own and this is its district's. */
  inherited: boolean;
};

const hasIdentity = (o: BrandingSource) => Boolean(o && (o.logoMediaId || o.brandName?.trim()));

/**
 * Identity (logo + name) and color resolve separately. A campus that sets a
 * logo or a display name uses its own identity; otherwise it takes its
 * district's, so a logo is never shown under another body's name. Color is
 * per field: a campus color wins, else the district's. Nothing set anywhere
 * means no co-branding.
 */
export function resolveBranding(school: BrandingSource, district: BrandingSource): OrganizationBranding | null {
  const identity = hasIdentity(school) ? school : hasIdentity(district) ? district : null;
  const colorRaw = school?.brandColor ?? district?.brandColor ?? null;
  if (!identity && !colorRaw) return null;

  const base = identity ?? school ?? district!;
  return {
    name: base.brandName?.trim() || base.officialName,
    logoMediaId: identity?.logoMediaId ?? null,
    accent: safeBrandAccent(colorRaw),
    inherited: identity ? identity === district && identity !== school : !school?.brandColor,
  };
}
