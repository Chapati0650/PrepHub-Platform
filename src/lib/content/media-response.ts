import { NextResponse } from "next/server";
import type { MediaAsset } from "@/generated/prisma/client";
import { getSignedReadUrl, readFromStorage } from "./storage";

// One response for both media routes (/api/media for everyone signed in,
// /api/owner/media for the Owner's CMS), which differ only in who may ask.

// Above this a file isn't sent through the function at all. Netlify refuses
// function responses over about 6MB, and an image may be up to 10MB.
const PROXY_MAX_BYTES = 4 * 1024 * 1024;

// A media id's file never changes — every upload gets a new random storage
// key and a new row — so a browser may keep what it fetched indefinitely
// instead of asking again on every page that shows the same image.
const IMMUTABLE = "private, max-age=31536000, immutable";

type ServableAsset = Pick<MediaAsset, "kind" | "storageKey" | "mimeType" | "sizeBytes">;

export async function mediaResponse(asset: ServableAsset, request: Request, now: Date = new Date()): Promise<Response> {
  if (asset.kind === "VIDEO" || asset.sizeBytes > PROXY_MAX_BYTES) {
    const signed = await getSignedReadUrl(asset.storageKey, now).catch(() => null);
    if (signed) {
      // The redirect itself may be cached, but never past the URL's expiry
      // (less a margin for a slow page), or the browser would follow a
      // cached redirect to a link that no longer works.
      const maxAge = Math.max(0, Math.floor((signed.expiresAt.getTime() - now.getTime()) / 1000) - 300);
      return new NextResponse(null, {
        status: 302,
        headers: { Location: signed.url, "Cache-Control": `private, max-age=${maxAge}` },
      });
    }
  }

  const data = await readFromStorage(asset.storageKey).catch(() => null);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const headers = { "Content-Type": asset.mimeType, "Accept-Ranges": "bytes", "Cache-Control": IMMUTABLE };
  const range = parseByteRange(request.headers.get("range"), data.byteLength);
  if (range === "unsatisfiable") {
    return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${data.byteLength}` } });
  }
  if (range) {
    const body = new Uint8Array(data.subarray(range.start, range.end + 1));
    return new NextResponse(body, {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(body.byteLength),
        "Content-Range": `bytes ${range.start}-${range.end}/${data.byteLength}`,
      },
    });
  }
  return new NextResponse(new Uint8Array(data), { headers: { ...headers, "Content-Length": String(data.byteLength) } });
}

/**
 * Reads a single-range `Range` header (`bytes=0-1023`, `bytes=500-`,
 * `bytes=-500`) against a file of `size` bytes. Safari asks for `bytes=0-1`
 * before it will play a video and refuses one served without a 206 answer.
 * Returns null when the whole file should be sent (no header, a multi-range
 * request, or one this doesn't understand — all of which a 200 answers
 * correctly), and "unsatisfiable" for a range that starts past the end.
 */
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    // A suffix: the last N bytes.
    const length = Number(rawEnd);
    if (length === 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return null;
  return { start, end };
}
