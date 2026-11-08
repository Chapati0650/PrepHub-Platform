"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { saveBrandingAction, type BrandingState } from "./branding-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { contrastRatio, normalizeHexColor, safeBrandAccent } from "@/lib/branding/colors";
import { BRAND_NAME_MAX } from "@/lib/branding/validate";
import { LOGO_MAX_BYTES } from "@/lib/branding/upload-logo-limits";

const initialState: BrandingState = {};

type Props = {
  id: string;
  officialName: string;
  logoMediaId: string | null;
  brandName: string | null;
  brandColor: string | null;
  /** For a campus: the district whose branding it inherits when it sets none of its own. */
  inheritedFrom: { name: string; hasBranding: boolean } | null;
};

/**
 * Owner-only co-branding editor with a live preview of the sidebar header and
 * the dashboard chip, so the Owner sees what students will.
 */
export function BrandingPanel({ id, officialName, logoMediaId, brandName, brandColor, inheritedFrom }: Props) {
  const [state, formAction, pending] = useActionState(saveBrandingAction, initialState);
  const [name, setName] = useState(brandName ?? "");
  const [color, setColor] = useState(brandColor ?? "");
  const [remove, setRemove] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    },
    [fileUrl],
  );

  const normalized = normalizeHexColor(color);
  const colorInvalid = color.trim() !== "" && !normalized;
  const accent = useMemo(() => safeBrandAccent(color), [color]);
  const shownName = name.trim() || officialName;
  const logoSrc = fileUrl ?? (remove ? null : logoMediaId ? `/api/media/${logoMediaId}` : null);

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-col gap-4">
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        {state.success && (
          <Alert>
            <AlertDescription>Saved. Students see the change on their next page load.</AlertDescription>
          </Alert>
        )}
        {inheritedFrom && (
          <p className="text-sm text-muted-foreground">
            {inheritedFrom.hasBranding
              ? `Leave the logo and display name empty to use ${inheritedFrom.name}'s branding. Anything you set here applies to this campus only.`
              : `${inheritedFrom.name} has no branding yet; set it on the district to cover every campus.`}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brandName">Display name (optional)</Label>
          <Input
            id="brandName"
            name="brandName"
            value={name}
            maxLength={BRAND_NAME_MAX}
            placeholder={officialName}
            className="h-11 text-base md:text-base"
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">Shown beside PrepHub. Empty uses the official name.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brandColor">Brand color (hex)</Label>
          <div className="flex items-center gap-3">
            <Input
              id="brandColor"
              name="brandColor"
              value={color}
              maxLength={7}
              placeholder="#BA0C2F"
              aria-invalid={colorInvalid}
              aria-describedby="brandColorHelp"
              className="h-11 max-w-40 text-base md:text-base"
              onChange={(e) => setColor(e.target.value)}
            />
            <span
              aria-hidden
              className="size-9 rounded-md border border-border"
              style={{ backgroundColor: normalized ?? "transparent" }}
            />
          </div>
          <p id="brandColorHelp" className="text-sm text-muted-foreground">
            {colorInvalid
              ? "Use a hex color such as #BA0C2F."
              : !normalized
                ? "Optional. Used as a small accent only; PrepHub keeps its own colors for body text."
                : accent
                  ? `Will be used. Text on it is ${accent.textColor === "#FFFFFF" ? "white" : "near-black"} (contrast ${contrastRatio(accent.color, accent.textColor).toFixed(1)}:1; AA needs 4.5:1).`
                  : "Too close to white to show up on the page, so PrepHub's own colors are used instead."}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="logo">Logo (PNG, JPG or SVG, up to 2 MB)</Label>
          <input
            id="logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            className="block w-full text-sm file:mr-3 file:h-11 file:rounded-md file:border file:border-border file:bg-background file:px-4 file:text-base"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setFileError(null);
              if (fileUrl) URL.revokeObjectURL(fileUrl);
              if (!f) return setFileUrl(null);
              if (f.size > LOGO_MAX_BYTES) {
                e.target.value = "";
                setFileUrl(null);
                return setFileError("That file is over 2 MB.");
              }
              setRemove(false);
              setFileUrl(URL.createObjectURL(f));
            }}
          />
          {fileError && <p className="text-sm text-destructive">{fileError}</p>}
          <p className="text-sm text-muted-foreground">
            Use only a logo the district has given permission to use. Wide logos on a transparent background work best.
            SVGs are converted to PNG.
          </p>
          {logoMediaId && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="removeLogo" checked={remove} onCheckedChange={(v) => setRemove(v === true)} />
              Remove the current logo
            </label>
          )}
        </div>

        <Button type="submit" size="lg" disabled={pending || colorInvalid} className="w-fit">
          {pending ? "Saving..." : "Save branding"}
        </Button>
      </div>

      <div className="flex flex-col gap-4" aria-label="Preview">
        <p className="text-sm font-medium">Preview</p>
        <div className="rounded-lg bg-sidebar p-4 text-sidebar-foreground">
          <p className="font-heading text-lg font-semibold">PrepHub</p>
          <div className="mt-3 flex items-center gap-2.5">
            <span aria-hidden className="text-sm text-sidebar-foreground/50">
              &times;
            </span>
            {logoSrc && (
              <span
                className="flex h-8 max-w-24 items-center justify-center rounded-md border-b-2 bg-white px-1.5 py-0.5"
                style={{ borderBottomColor: accent?.color ?? "transparent" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoSrc} alt="" className="max-h-full w-auto object-contain" />
              </span>
            )}
            <span className="truncate text-sm font-medium text-sidebar-foreground/90">{shownName}</span>
          </div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p
            className={
              accent
                ? "inline-flex w-fit items-center gap-2 rounded-full border border-black/10 px-3 py-1 text-sm font-medium"
                : "inline-flex w-fit items-center gap-2 rounded-full bg-surface-tint px-3 py-1 text-sm font-medium"
            }
            style={accent ? { backgroundColor: accent.color, color: accent.textColor } : undefined}
          >
            {shownName}
          </p>
          <p className="mt-3 text-page-title">Good afternoon, Maya</p>
        </div>
      </div>
    </form>
  );
}
