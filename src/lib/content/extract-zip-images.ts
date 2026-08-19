import JSZip from "jszip";

const EXTENSION_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// Runs entirely in the browser (bulk-upload-form.tsx is a client component)
// — no server round trip for the zip itself. This is what lets a zip drop
// straight into the exact same per-image Row list/concurrency pool the
// regular multi-file picker already builds, with zero server-side changes:
// by the time processing starts, a zip's contents and a plain multi-select
// are indistinguishable File[] arrays.
export function isImageEntry(path: string): boolean {
  const basename = path.split("/").pop() ?? "";
  if (!basename || basename.startsWith(".")) return false; // .DS_Store, dotfiles
  if (path.startsWith("__MACOSX/")) return false; // macOS zip metadata folder
  const ext = basename.split(".").pop()?.toLowerCase();
  return !!ext && ext in EXTENSION_MIME;
}

export type ExtractZipImagesResult = { images: File[]; skipped: string[] };

export async function extractImagesFromZip(zipFile: File): Promise<ExtractZipImagesResult> {
  const zip = await JSZip.loadAsync(zipFile);
  const images: File[] = [];
  const skipped: string[] = [];

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  for (const entry of entries) {
    if (!isImageEntry(entry.name)) {
      if (!entry.name.startsWith("__MACOSX/") && !(entry.name.split("/").pop() ?? "").startsWith(".")) {
        skipped.push(entry.name);
      }
      continue;
    }
    const basename = entry.name.split("/").pop()!;
    const ext = basename.split(".").pop()!.toLowerCase();
    const blob = await entry.async("blob");
    images.push(new File([blob], basename, { type: EXTENSION_MIME[ext] }));
  }

  return { images, skipped };
}
