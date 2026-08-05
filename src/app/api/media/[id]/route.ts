import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { readFromStorage } from "@/lib/content/storage";

// Student-facing counterpart to /api/owner/media — any authenticated user may
// fetch a READY media asset by its unguessable id (question images, answer
// choice images, explanation videos). Content is scoped to authenticated
// users only, not by role: the underlying assets aren't sensitive on their
// own, only the CMS metadata around them is Owner-only (see the Owner route).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.status !== "READY") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = await readFromStorage(asset.storageKey).catch(() => null);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(data.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
