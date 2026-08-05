"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { uploadImageAction, uploadVideoAction } from "./actions";

// PRD-015 §9: upload progress / processing / success / failure states. True
// byte-level progress would need XHR instead of a server action — we show the
// coarser Uploading → Processing → Ready/Failed states the PRD actually
// requires, not a percentage bar.
export function MediaUploadField({
  kind,
  currentMediaId,
  currentUrl,
  onUploaded,
  onRemove,
  accept,
}: {
  kind: "image" | "video";
  currentMediaId: string | null;
  currentUrl: string | null;
  onUploaded: (mediaId: string) => void;
  onRemove: () => void;
  accept: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading" | "processing" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setState("uploading");
    const formData = new FormData();
    formData.set("file", file);
    setState("processing");
    const result = kind === "image" ? await uploadImageAction(formData) : await uploadVideoAction(formData);
    if (result.error) {
      setState("failed");
      setError(result.error);
      return;
    }
    if (result.status === "FAILED") {
      setState("failed");
      setError(result.failureReason ?? "Processing failed.");
      return;
    }
    setState("idle");
    onUploaded(result.mediaId!);
  }

  return (
    <div className="flex flex-col gap-2">
      {currentMediaId && currentUrl && (
        <div className="flex items-center gap-3">
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentUrl} alt="" className="h-20 w-20 rounded object-cover" />
          ) : (
            <video src={currentUrl} controls className="h-32 max-w-xs rounded" />
          )}
          <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={state === "uploading" || state === "processing"}
        onClick={() => inputRef.current?.click()}
      >
        {state === "uploading" || state === "processing"
          ? "Uploading…"
          : currentMediaId
            ? "Replace"
            : "Upload"}
      </Button>

      {state === "failed" && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
