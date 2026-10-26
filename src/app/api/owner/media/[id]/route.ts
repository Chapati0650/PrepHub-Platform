import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { mediaResponse } from "@/lib/content/media-response";
import { logUnauthorizedAccess } from "@/lib/logger";

// PRD-015 §14: only the Owner may access content-management data, which
// includes the raw uploaded media backing question images/videos.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    logUnauthorizedAccess("Non-Owner attempted to fetch Owner-only media", {
      accountId: session?.user.id,
      role: session?.user.role,
    });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.status !== "READY") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return mediaResponse(asset, req);
}
