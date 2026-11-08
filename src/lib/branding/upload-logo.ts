import sharp from "sharp";
import type { MediaAsset } from "@/generated/prisma/client";
import { ContentError } from "@/lib/content/errors";
import { uploadImage } from "@/lib/content/media";
import { LOGO_MAX_BYTES } from "./upload-logo-limits";

export const LOGO_MIN_DIMENSION = 32;
export const LOGO_MAX_ASPECT_RATIO = 6;
/** A logo is shown at most ~120px wide; 1024 keeps it sharp on retina without storing a huge file. */
export const LOGO_MAX_EDGE = 1024;

const ALLOWED = new Set(["image/png", "image/jpeg", "image/svg+xml"]);

export type LogoCheck = { ok: true } | { ok: false; error: string };

/** Dimension and shape sanity for a decoded logo; pure so it can be unit tested. */
export function checkLogoDimensions(width: number, height: number): LogoCheck {
  if (width < LOGO_MIN_DIMENSION || height < LOGO_MIN_DIMENSION) {
    return { ok: false, error: `The logo is too small. Use at least ${LOGO_MIN_DIMENSION} by ${LOGO_MIN_DIMENSION} pixels.` };
  }
  const ratio = Math.max(width / height, height / width);
  if (ratio > LOGO_MAX_ASPECT_RATIO) {
    return { ok: false, error: "The logo is too wide or too tall. Crop it so its long side is at most 6 times its short side." };
  }
  return { ok: true };
}

/**
 * Stores an organization logo through the existing media pipeline (R2 in
 * production, local disk in dev). SVG is accepted but never stored or served as
 * SVG: it is rasterized to PNG here, which drops any script or external
 * reference an SVG could carry. Throws ContentError with a message safe to show.
 */
export async function uploadOrganizationLogo(input: {
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
}): Promise<MediaAsset> {
  if (!ALLOWED.has(input.mimeType)) {
    throw new ContentError("UNSUPPORTED_FILE_TYPE", "Logos must be PNG, JPG or SVG.");
  }
  if (input.buffer.byteLength > LOGO_MAX_BYTES) {
    throw new ContentError("FILE_TOO_LARGE", "Logos must be 2 MB or smaller.");
  }

  let buffer = input.buffer;
  let mimeType = input.mimeType;
  let filename = input.originalFilename;

  if (input.mimeType === "image/svg+xml") {
    const raster = await sharp(input.buffer, { density: 300, failOn: "error" })
      .resize(LOGO_MAX_EDGE, LOGO_MAX_EDGE, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer()
      .catch(() => null);
    if (!raster) throw new ContentError("UNSUPPORTED_FILE_TYPE", "This SVG could not be read.");
    buffer = raster;
    mimeType = "image/png";
    filename = filename.replace(/\.svg$/i, "") + ".png";
  }

  const meta = await sharp(buffer).metadata().catch(() => null);
  if (!meta?.width || !meta.height) {
    throw new ContentError("UNSUPPORTED_FILE_TYPE", "This file could not be read as an image.");
  }
  const check = checkLogoDimensions(meta.width, meta.height);
  if (!check.ok) throw new ContentError("UNSUPPORTED_FILE_TYPE", check.error);

  return uploadImage({ buffer, mimeType, originalFilename: filename });
}
