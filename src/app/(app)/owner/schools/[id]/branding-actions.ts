"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import { ContentError } from "@/lib/content/errors";
import { parseBrandingInput } from "@/lib/branding/validate";
import { uploadOrganizationLogo } from "@/lib/branding/upload-logo";

export type BrandingState = { error?: string; success?: boolean };

async function requireOwner() {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    logUnauthorizedAccess("Non-Owner attempted an Owner-only branding action", {
      accountId: session?.user.id,
      role: session?.user.role,
    });
    redirect("/home");
  }
}

function done(id: string): BrandingState {
  revalidatePath(`/owner/schools/${id}`);
  // The app shell renders on every authenticated route.
  revalidatePath("/", "layout");
  return { success: true };
}

/** Saves the display name and color, and optionally replaces or removes the logo, in one submit. */
export async function saveBrandingAction(_prev: BrandingState, formData: FormData): Promise<BrandingState> {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  const org = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
  if (!org) return { error: "That organization no longer exists." };

  const parsed = parseBrandingInput(formData.get("brandName"), formData.get("brandColor"));
  if ("error" in parsed) return { error: parsed.error };

  let logoMediaId: string | null | undefined; // undefined = leave as is
  if (formData.get("removeLogo") === "on") logoMediaId = null;
  const file = formData.get("logo");
  if (file instanceof File && file.size > 0) {
    try {
      const asset = await uploadOrganizationLogo({
        buffer: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type,
        originalFilename: file.name,
      });
      logoMediaId = asset.id;
    } catch (err) {
      if (err instanceof ContentError) return { error: err.message };
      throw err;
    }
  }

  await prisma.organization.update({
    where: { id },
    data: { ...parsed.value, ...(logoMediaId !== undefined ? { logoMediaId } : {}) },
  });
  return done(id);
}
