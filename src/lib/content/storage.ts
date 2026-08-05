import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Local-disk backed storage for uploaded question media (PRD-015 §9). Every
// other module in src/lib/content/ only calls the three functions below, so
// swapping to an object-storage backend later (see CLAUDE.md build-order notes
// on hosting) means changing this one file, not the callers.
const STORAGE_ROOT = process.env.CONTENT_STORAGE_ROOT ?? path.join(process.cwd(), ".content-storage");

function resolveKeyPath(key: string): string {
  // turbopackIgnore: STORAGE_ROOT is a runtime-only path outside the source
  // tree (.content-storage/, gitignored) — without this, Turbopack's static
  // analysis traces the whole project as a build dependency of this join().
  const resolved = path.join(/* turbopackIgnore: true */ STORAGE_ROOT, key);
  if (!resolved.startsWith(STORAGE_ROOT)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

export async function saveToStorage(key: string, data: Buffer): Promise<void> {
  const filePath = resolveKeyPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
}

export async function readFromStorage(key: string): Promise<Buffer> {
  return readFile(resolveKeyPath(key));
}

export async function deleteFromStorage(key: string): Promise<void> {
  await unlink(resolveKeyPath(key)).catch(() => {});
}

// Escape hatch for local-disk-only processing (ffmpeg needs a real file path,
// not a byte stream). Not part of the swappable interface — a future
// object-storage backend would need to download the file locally before
// probing it, which is a problem for that migration, not for callers today.
export function getLocalPathForProcessing(key: string): string {
  return resolveKeyPath(key);
}
