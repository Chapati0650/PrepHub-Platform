import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Uploaded question media (PRD-015 §9), behind one swappable interface —
// saveToStorage/readFromStorage/deleteFromStorage are the only three
// functions every other module in src/lib/content/ calls, so this is the one
// file that has to change to swap backends, exactly as originally designed.
//
// Two backends live behind that interface: local disk (zero-setup default,
// used whenever the R2 env vars below aren't all present — e.g. local dev)
// and Cloudflare R2 (S3-compatible, free up to 10GB with no egress fees) —
// used once R2_BUCKET_NAME/R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY
// are all set. Switched from local-disk-only specifically to unblock
// deploying on a serverless host (no persistent filesystem) at zero storage
// cost; a contributor can still point local dev at a real R2 bucket to test
// that path, since the choice is made by "are the R2 vars present," not by
// NODE_ENV.
const R2_CONFIGURED = Boolean(
  process.env.R2_BUCKET_NAME && process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY,
);

let cachedClient: S3Client | null = null;

function getR2(): { client: S3Client; bucket: string } {
  const bucket = process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 storage is not configured for this environment.");
  }
  if (!cachedClient) {
    // R2 has no regions of its own — "auto" is Cloudflare's documented value,
    // routing to wherever the bucket actually lives.
    cachedClient = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
  }
  return { client: cachedClient, bucket };
}

// --- Local disk backend (dev default) ---------------------------------------
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

export async function saveToStorage(key: string, data: Buffer, contentType?: string): Promise<void> {
  if (R2_CONFIGURED) {
    const { client, bucket } = getR2();
    // The type is stored with the object because a signed URL (below) has R2
    // serve it directly, and Safari won't play a video whose type it can't
    // trust. Objects saved before this carry R2's generic default.
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }));
    return;
  }
  const filePath = resolveKeyPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
}

export async function readFromStorage(key: string): Promise<Buffer> {
  if (R2_CONFIGURED) {
    const { client, bucket } = getR2();
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) throw new Error("Object has no body");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  return readFile(resolveKeyPath(key));
}

const SIGNED_URL_BUCKET_MS = 60 * 60 * 1000;

/**
 * A time-limited URL that reads the object straight from R2, or null on the
 * local-disk backend. R2 answers byte-range requests, which is what Safari
 * needs to play a video at all, and a file served from there never passes
 * through a serverless function, whose response size is capped (about 6MB on
 * Netlify) — far below the 500MB a video may be.
 *
 * Every URL is signed as of the start of the current hour and lasts two, so
 * everyone asking within the same hour gets the identical URL — which lets
 * the browser cache the file across page views — and any URL handed out
 * still has at least an hour to run.
 */
export async function getSignedReadUrl(key: string, now: Date = new Date()): Promise<{ url: string; expiresAt: Date } | null> {
  if (!R2_CONFIGURED) return null;
  const { client, bucket } = getR2();
  const signingDate = new Date(Math.floor(now.getTime() / SIGNED_URL_BUCKET_MS) * SIGNED_URL_BUCKET_MS);
  const lifetimeMs = 2 * SIGNED_URL_BUCKET_MS;
  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: lifetimeMs / 1000,
    signingDate,
  });
  return { url, expiresAt: new Date(signingDate.getTime() + lifetimeMs) };
}

export async function deleteFromStorage(key: string): Promise<void> {
  if (R2_CONFIGURED) {
    const { client, bucket } = getR2();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
    return;
  }
  await unlink(resolveKeyPath(key)).catch(() => {});
}
