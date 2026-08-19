import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile as writeTempFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import type { MediaAsset } from "@/generated/prisma/client";
import { logMediaFailure } from "@/lib/logger";
import { ContentError } from "./errors";
import { deleteFromStorage, saveToStorage } from "./storage";

const execFileAsync = promisify(execFile);

// PRD-015 §9.2
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 4096;
const IMAGE_MIME_TO_FORMAT: Record<string, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

// PRD-015 §9.3
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
export const VIDEO_MAX_DURATION_SECONDS = 30 * 60;
const VIDEO_MIME_TO_EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

type UploadInput = { buffer: Buffer; mimeType: string; originalFilename: string };

// Images process synchronously and either succeed (a READY row is created) or
// throw before any row exists — sharp validates real image content, not just
// the client-declared mimetype, so a mistyped/corrupt upload is rejected here
// as an editing-validation error (PRD-015 §6.5), not a stored Failed state.
export async function uploadImage(input: UploadInput): Promise<MediaAsset> {
  const format = IMAGE_MIME_TO_FORMAT[input.mimeType];
  if (!format) {
    throw new ContentError(
      "UNSUPPORTED_FILE_TYPE",
      "Images must be PNG, JPEG, or WebP. SVG uploads are not supported.",
    );
  }
  if (input.buffer.byteLength > IMAGE_MAX_BYTES) {
    throw new ContentError("FILE_TOO_LARGE", "Images must be 10 MB or smaller.");
  }

  let image = sharp(input.buffer, { failOn: "error" });
  const metadata = await image.metadata().catch(() => null);
  if (!metadata?.width || !metadata.height) {
    throw new ContentError("UNSUPPORTED_FILE_TYPE", "This file could not be read as an image.");
  }

  if (metadata.width > IMAGE_MAX_DIMENSION || metadata.height > IMAGE_MAX_DIMENSION) {
    image = image.resize(IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const { data, info } = await image.toFormat(format, { quality: 85 }).toBuffer({ resolveWithObject: true });

  const key = `images/${randomUUID()}.${format === "jpeg" ? "jpg" : format}`;
  await saveToStorage(key, data);

  return prisma.mediaAsset.create({
    data: {
      kind: "IMAGE",
      status: "READY",
      storageKey: key,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: data.byteLength,
      width: info.width,
      height: info.height,
    },
  });
}

// Videos get the fuller Uploading/Processing/Success/Failure state machine from
// PRD-015 §9.3: type/size are checked up front (editing validation, no row), but
// duration can only be known after probing the written file, so a PROCESSING row
// is created first and resolved to READY or FAILED — a failure is returned, not
// thrown, so the Owner sees a persisted Failed state with a Retry action.
export async function uploadVideo(input: UploadInput): Promise<MediaAsset> {
  const extension = VIDEO_MIME_TO_EXTENSION[input.mimeType];
  if (!extension) {
    throw new ContentError("UNSUPPORTED_FILE_TYPE", "Videos must be MP4 or WebM.");
  }
  if (input.buffer.byteLength > VIDEO_MAX_BYTES) {
    throw new ContentError("FILE_TOO_LARGE", "Videos must be 500 MB or smaller.");
  }

  const key = `videos/${randomUUID()}.${extension}`;
  const asset = await prisma.mediaAsset.create({
    data: {
      kind: "VIDEO",
      status: "PROCESSING",
      storageKey: key,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.byteLength,
    },
  });

  try {
    await saveToStorage(key, input.buffer);
    const durationSeconds = await probeVideoDurationSeconds(input.buffer, extension);
    if (durationSeconds > VIDEO_MAX_DURATION_SECONDS) {
      await deleteFromStorage(key);
      return await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: "FAILED", failureReason: "Video exceeds the 30-minute limit." },
      });
    }
    return await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "READY", durationSeconds: Math.round(durationSeconds) },
    });
  } catch (err) {
    logMediaFailure("Video processing failed", {
      affectedResourceId: asset.id,
      errorType: err instanceof Error ? err.message : String(err),
    });
    await deleteFromStorage(key);
    return prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "FAILED", failureReason: "This video could not be processed. Try a different file." },
    });
  }
}

async function probeVideoDurationSeconds(buffer: Buffer, extension: string): Promise<number> {
  if (!ffmpegPath) throw new Error("ffmpeg binary unavailable");

  // ffmpeg needs a real file on disk to probe regardless of where the
  // durable copy lives (see storage.ts's R2/local-disk split) — os.tmpdir()
  // is writable even on a serverless host with no other persistent
  // filesystem, and this copy only needs to survive this one probe.
  const dir = await mkdtemp(path.join(tmpdir(), "prephub-video-"));
  const filePath = path.join(dir, `probe.${extension}`);

  let stderr = "";
  try {
    await writeTempFile(filePath, buffer);
    // ffmpeg with no output file just prints container info (incl. Duration) to
    // stderr and exits non-zero — that's expected; we only need the parsed text.
    try {
      await execFileAsync(ffmpegPath, ["-i", filePath], { timeout: 30_000 });
    } catch (err) {
      stderr = typeof err === "object" && err && "stderr" in err ? String((err as { stderr: unknown }).stderr) : "";
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error("Could not determine video duration");
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}
