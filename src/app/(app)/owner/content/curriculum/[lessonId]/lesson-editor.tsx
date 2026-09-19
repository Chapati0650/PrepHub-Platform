"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { parseYouTubeVideoId, youTubeEmbedUrl } from "@/lib/curriculum/youtube";
import { uploadVideoAction } from "../../actions";
import { setLessonPublishedAction, updateLessonAction, type CurriculumActionState } from "../actions";
import { cn } from "@/lib/utils";

const initial: CurriculumActionState = {};

export type LessonEditorData = {
  id: string;
  title: string;
  description: string;
  videoSource: "YOUTUBE" | "UPLOAD";
  youtubeVideoId: string | null;
  mediaAssetId: string | null;
  mediaAsset: { id: string; status: string; originalFilename: string; failureReason: string | null } | null;
  durationSeconds: number | null;
  isFree: boolean;
  publishedAt: Date | null;
};

export function LessonEditor({ lesson }: { lesson: LessonEditorData }) {
  const [state, save, saving] = useActionState(updateLessonAction, initial);
  const [publishState, publish, publishing] = useActionState(setLessonPublishedAction, initial);

  // Every field is controlled. After a save the page re-renders with the
  // lesson's fresh values, and Base UI (correctly) warns when an uncontrolled
  // field's defaultValue changes underneath it. State seeded from props once,
  // then owned here — what the Owner typed is what stays on screen.
  const [title, setTitle] = useState(lesson.title);
  const [description, setDescription] = useState(lesson.description);
  const [durationMinutes, setDurationMinutes] = useState(lesson.durationSeconds ? String(Math.round(lesson.durationSeconds / 60)) : "");
  const [isFree, setIsFree] = useState(lesson.isFree);
  const [source, setSource] = useState<"YOUTUBE" | "UPLOAD">(lesson.videoSource);
  const [youtubeUrl, setYoutubeUrl] = useState(lesson.youtubeVideoId ?? "");
  const [mediaAssetId, setMediaAssetId] = useState(lesson.mediaAssetId);
  const [mediaStatus, setMediaStatus] = useState<{ status: string; name: string; failureReason: string | null } | null>(
    lesson.mediaAsset ? { status: lesson.mediaAsset.status, name: lesson.mediaAsset.originalFilename, failureReason: lesson.mediaAsset.failureReason } : null,
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const previewId = source === "YOUTUBE" ? parseYouTubeVideoId(youtubeUrl) : null;

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    const fd = new FormData();
    fd.set("file", file);
    const result = await uploadVideoAction(fd);
    setUploading(false);
    if (result.error || !result.mediaId) {
      setUploadError(result.error ?? "Upload failed.");
      return;
    }
    setMediaAssetId(result.mediaId);
    setMediaStatus({ status: result.status ?? "READY", name: file.name, failureReason: result.failureReason ?? null });
  }

  return (
    <div className="flex flex-col gap-8">
      <form action={save} className="flex flex-col gap-6">
        <input type="hidden" name="lessonId" value={lesson.id} />
        <input type="hidden" name="videoSource" value={source} />
        <input type="hidden" name="mediaAssetId" value={mediaAssetId ?? ""} />

        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} className="max-w-xl" />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={2000} className="max-w-xl" />
          <p className="text-xs text-muted-foreground">Shown under the lesson title and, in one line, in the syllabus.</p>
        </div>

        {/* Video source. The YouTube option stores only the parsed video id
            (see lib/curriculum/youtube.ts); the upload option goes through
            the same pipeline as question explanation videos, so the file
            limits and the READY/FAILED states are the ones the Owner already
            knows from the question editor. */}
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Video</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Video source">
            {(["YOUTUBE", "UPLOAD"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={source === opt}
                onClick={() => setSource(opt)}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm transition-colors",
                  source === opt ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-muted",
                )}
              >
                {opt === "YOUTUBE" ? "YouTube link" : "Upload a file"}
              </button>
            ))}
          </div>

          {source === "YOUTUBE" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="youtubeUrl">YouTube URL or video id</Label>
              <Input
                id="youtubeUrl"
                name="youtubeUrl"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                className="max-w-xl"
              />
              {youtubeUrl.trim() && !previewId && <p className="text-sm text-destructive">That doesn&apos;t look like a YouTube link.</p>}
              {previewId && (
                <div className="mt-2 max-w-xl overflow-hidden rounded-2xl bg-black">
                  <iframe src={youTubeEmbedUrl(previewId)} title="Preview" className="aspect-video w-full" allowFullScreen />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="videoFile">MP4 or WebM, up to 500 MB and 30 minutes</Label>
              <Input
                id="videoFile"
                type="file"
                accept="video/mp4,video/webm"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                }}
                className="max-w-xl"
              />
              {uploading && <p className="text-sm text-muted-foreground">Uploading…</p>}
              {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
              {mediaStatus && !uploading && (
                <p className={cn("text-sm", mediaStatus.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>
                  {mediaStatus.name} · {mediaStatus.status === "READY" ? "ready" : mediaStatus.status === "FAILED" ? `failed: ${mediaStatus.failureReason ?? "unknown"}` : mediaStatus.status.toLowerCase()}
                </p>
              )}
              {mediaAssetId && mediaStatus?.status === "READY" && (
                <div className="mt-2 max-w-xl overflow-hidden rounded-2xl bg-black">
                  <video controls className="aspect-video w-full" src={`/api/owner/media/${mediaAssetId}`} />
                </div>
              )}
            </div>
          )}
        </fieldset>

        <div className="grid max-w-xl grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="durationMinutes">Duration (minutes)</Label>
            <Input
              id="durationMinutes"
              name="durationMinutes"
              type="number"
              min={1}
              step={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className="max-w-32"
            />
            <p className="text-xs text-muted-foreground">Shown in the syllabus and summed into the course total.</p>
          </div>
          <label className="flex items-start gap-3 pt-7 text-sm">
            <Checkbox name="isFree" checked={isFree} onCheckedChange={(checked) => setIsFree(checked === true)} aria-label="Free lesson" />
            <span>
              <span className="block font-medium">Free lesson</span>
              <span className="block text-muted-foreground">Playable without Premium — a taster. Everything else needs paid access.</span>
            </span>
          </label>
        </div>

        <div className="flex items-center gap-4">
          <Button type="submit" disabled={saving || uploading} className="rounded-full px-5">
            {saving ? "Saving…" : "Save lesson"}
          </Button>
          {state.saved && !saving && <span className="text-sm text-muted-foreground">Saved.</span>}
        </div>
      </form>

      <form action={publish} className="flex flex-col gap-3 rounded-2xl border border-border p-5">
        <input type="hidden" name="lessonId" value={lesson.id} />
        <input type="hidden" name="published" value={lesson.publishedAt ? "false" : "true"} />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-medium">{lesson.publishedAt ? "Published" : "Draft"}</p>
            <p className="text-sm text-muted-foreground">
              {lesson.publishedAt
                ? "Students can see this lesson in the syllabus. Save your edits first — they apply immediately."
                : "Hidden from students. Save the lesson with a working video, then publish."}
            </p>
          </div>
          <Button type="submit" variant={lesson.publishedAt ? "outline" : "default"} disabled={publishing} className="rounded-full px-5">
            {publishing ? "…" : lesson.publishedAt ? "Unpublish" : "Publish"}
          </Button>
        </div>
        {publishState.error && (
          <Alert variant="destructive">
            <AlertDescription>{publishState.error}</AlertDescription>
          </Alert>
        )}
      </form>
    </div>
  );
}
