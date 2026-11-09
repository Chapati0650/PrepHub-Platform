import Image from "next/image";
import type { OrganizationBranding } from "@/lib/branding/resolve";

/**
 * "PrepHub x Houston ISD": the organization's mark and name beside PrepHub's
 * identity, never in place of it. Sits under the PrepHub logo on the dark
 * sidebar, so the mark gets a white tile (a transparent PNG or a dark logo stays
 * legible). The brand color is only a thin decorative underline here; all text
 * uses the sidebar's own foreground.
 */
export function SidebarCoBrand({ branding }: { branding: OrganizationBranding }) {
  return (
    <div className="flex items-center gap-2.5 px-2" data-testid="co-brand">
      {/* "×" beside a logo reads as a partnership mark; on its own it looked like a close button
          (review, 2026-11-09), so a name with no logo reads "with Houston ISD". */}
      <span aria-hidden className="text-sm text-sidebar-foreground/50">
        {branding.logoMediaId ? <>&times;</> : "with"}
      </span>
      {branding.logoMediaId && (
        <span
          className="flex h-8 max-w-24 shrink-0 items-center justify-center rounded-md border-b-2 bg-white px-1.5 py-0.5"
          style={{ borderBottomColor: branding.accent?.color ?? "transparent" }}
        >
          <Image
            src={`/api/media/${branding.logoMediaId}`}
            alt=""
            width={80}
            height={28}
            unoptimized
            className="max-h-full w-auto object-contain"
          />
        </span>
      )}
      <span className="min-w-0 truncate text-sm font-medium text-sidebar-foreground/90">{branding.name}</span>
    </div>
  );
}

/**
 * The name on the brand color, for the dashboard hero. Text color is the
 * computed AA-safe one; with no usable accent it falls back to PrepHub's
 * own palette.
 */
export function BrandChip({ branding }: { branding: OrganizationBranding }) {
  const accent = branding.accent;
  return (
    <p
      className={
        accent
          ? "inline-flex w-fit items-center gap-2 rounded-full border border-black/10 px-3 py-1 text-sm font-medium"
          : "inline-flex w-fit items-center gap-2 rounded-full bg-surface-tint px-3 py-1 text-sm font-medium text-foreground"
      }
      style={accent ? { backgroundColor: accent.color, color: accent.textColor } : undefined}
      data-testid="brand-chip"
    >
      {branding.logoMediaId && (
        <span className="flex h-5 items-center rounded-sm bg-white px-1">
          <Image
            src={`/api/media/${branding.logoMediaId}`}
            alt=""
            width={40}
            height={16}
            unoptimized
            className="max-h-full w-auto object-contain"
          />
        </span>
      )}
      {branding.name}
    </p>
  );
}
