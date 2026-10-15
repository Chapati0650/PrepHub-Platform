"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Upload, Trash2 } from "lucide-react";
import { uploadImageAction } from "../../content/actions";
import { setOrganizationLogoAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * The district's mark, shown to its own students inside the product.
 *
 * Reuses the Owner CMS image upload and the existing /api/media route rather
 * than introducing a second way to store a picture — one storage path, one
 * place to change when it moves.
 */
export function LogoForm({ id, logoMediaId }: { id: string; logoMediaId: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadImageAction(fd);
      if (res.error || !res.mediaId) {
        setError(res.error ?? "That image could not be uploaded.");
        return;
      }
      startTransition(() => void setOrganizationLogoAction(id, res.mediaId!));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const busy = pending || uploading;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {logoMediaId ? (
          <span className="flex size-16 items-center justify-center rounded-lg border border-border bg-white p-1.5">
            <Image
              src={`/api/media/${logoMediaId}`}
              alt="District logo"
              width={56}
              height={56}
              unoptimized
              className="max-h-full w-auto object-contain"
            />
          </span>
        ) : (
          <span className="flex size-16 items-center justify-center rounded-lg border border-dashed border-border text-caption text-muted-foreground">
            None
          </span>
        )}

        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
          <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" aria-hidden />
            {busy ? "Uploading..." : logoMediaId ? "Replace logo" : "Upload logo"}
          </Button>
          {logoMediaId && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => startTransition(() => void setOrganizationLogoAction(id, null))}
            >
              <Trash2 className="size-4" aria-hidden />
              Remove
            </Button>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Shown in the sidebar to this organization&apos;s own students. A transparent PNG or SVG works best — it sits on
        a dark panel. Use it only with the district&apos;s permission.
      </p>
    </div>
  );
}
