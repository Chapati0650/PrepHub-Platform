"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UploadCloud, FileArchive, FileText, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { toast } from "@/components/ui/toast";
import { extractImagesFromZip } from "@/lib/content/extract-zip-images";
import { pickImagesFromDrive } from "@/lib/google/drive-picker";
import { AbsoluteTimeoutError, SuspectedSleepError, raceAgainstSuspendOrTimeout } from "@/lib/content/suspend-detection";
import { bulkUploadImageAction, bulkUploadPdfPageAction } from "../../actions";

// One image ≈ transcribe + determine answer + write an explanation —
// roughly 20-30s of sequential AI calls. A concurrency pool keeps a batch of
// 20 images from taking 10 minutes sequentially, without firing 20 requests
// at once and risking API rate limits. A PDF page goes through the same pool
// as a single unit even though it can yield several questions — the
// transcription call itself (the slow part) still only runs once per page.
const CONCURRENCY = 3;

// Public by design (inlined client-side, restricted by domain in the Google
// Cloud Console the same way the Desmos key is) — see drive-picker.ts's
// top comment for why this is a separate credential from AUTH_GOOGLE_ID.
const GOOGLE_PICKER_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;

type RowStatus = "queued" | "processing" | "done" | "error";
// "image" rows (plain photo/screenshot, a zip's contents, or a Drive pick)
// always resolve to 0 or 1 question. "pdfPage" rows (one rendered page of an
// uploaded PDF — see extract-pdf-pages.ts) can resolve to zero, one, or
// several, since a single page may contain multiple complete questions or
// none at all (a cover/instructions page) — questionIds/errors are always
// arrays so both row kinds share one shape and one rendering path.
// alreadyUploaded: true means the server recognized this exact file as one
// it already processed (see bulk-upload.ts's sourceImageHash check) and
// returned the existing question(s) without spending a new AI call — shown
// distinctly so it doesn't read as a fresh, newly-generated result.
type Row = { file: File; kind: "image" | "pdfPage"; status: RowStatus; questionIds: string[]; errors: string[]; alreadyUploaded?: boolean };

export function BulkUploadForm({ googleClientId }: { googleClientId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [extractingZip, setExtractingZip] = useState(false);
  const [extractingPdf, setExtractingPdf] = useState(false);
  const [pickingFromDrive, setPickingFromDrive] = useState(false);
  const driveAvailable = Boolean(googleClientId && GOOGLE_PICKER_API_KEY);

  // Leaving mid-batch (closing the tab, typing a new URL, hitting back) is a
  // real page unload, unlike clicking a same-app Link — that actually aborts
  // any in-flight request, unlike client-side navigation which just unmounts
  // this component while the requests keep running to completion in the
  // background. Warn specifically for the case that really does lose work.
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (running) e.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running]);

  // Additive rather than replacing: lets an Owner combine a zip with a few
  // loose images, or select images in more than one pass, instead of losing
  // an earlier selection the moment they pick more files.
  function addFiles(files: File[], kind: Row["kind"] = "image") {
    setRows((prev) => [...prev, ...files.map((file) => ({ file, kind, status: "queued" as const, questionIds: [], errors: [] }))]);
  }

  function handleFilesSelected(files: FileList | null) {
    if (!files) return;
    addFiles(Array.from(files));
  }

  async function handleZipSelected(files: FileList | null) {
    const zipFile = files?.[0];
    if (!zipFile) return;
    setExtractingZip(true);
    try {
      const { images, skipped } = await extractImagesFromZip(zipFile);
      if (images.length === 0) {
        toast.add({ title: "No images found in that zip", type: "error" });
        return;
      }
      addFiles(images);
      toast.add({
        title: `Added ${images.length} image${images.length === 1 ? "" : "s"} from ${zipFile.name}`,
        description: skipped.length > 0 ? `Skipped ${skipped.length} non-image file${skipped.length === 1 ? "" : "s"} in the zip.` : undefined,
        type: "success",
      });
    } catch {
      toast.add({ title: "Couldn't read that zip file", description: "Make sure it's a valid .zip archive.", type: "error" });
    } finally {
      setExtractingZip(false);
    }
  }

  async function handlePdfSelected(files: FileList | null) {
    const pdfFile = files?.[0];
    if (!pdfFile) return;
    setExtractingPdf(true);
    try {
      // Dynamically imported, not statically — pdfjs-dist touches
      // browser-only APIs (DOMMatrix) at module-evaluation time, which
      // breaks Next.js's server-side pre-render of this "use client"
      // component if it's ever loaded eagerly. Deferring the import to
      // inside this handler keeps it out of both the server render and the
      // initial client bundle, only fetching it once a PDF is actually
      // selected — confirmed via a real SSR failure ("DOMMatrix is not
      // defined") before this fix.
      const { extractPagesFromPdf } = await import("@/lib/content/extract-pdf-pages");
      const { pages } = await extractPagesFromPdf(pdfFile);
      if (pages.length === 0) {
        toast.add({ title: "That PDF has no pages", type: "error" });
        return;
      }
      addFiles(pages, "pdfPage");
      toast.add({ title: `Added ${pages.length} page${pages.length === 1 ? "" : "s"} from ${pdfFile.name}`, type: "success" });
    } catch (err) {
      toast.add({
        title: "Couldn't read that PDF",
        description: err instanceof Error ? err.message : "Make sure it's a valid, unencrypted PDF file.",
        type: "error",
      });
    } finally {
      setExtractingPdf(false);
    }
  }

  async function handleDrivePick() {
    if (!googleClientId || !GOOGLE_PICKER_API_KEY) return;
    setPickingFromDrive(true);
    try {
      const { images, skipped } = await pickImagesFromDrive(googleClientId, GOOGLE_PICKER_API_KEY);
      if (images.length === 0 && skipped.length === 0) return; // cancelled the picker/consent popup
      if (images.length > 0) {
        addFiles(images);
        toast.add({
          title: `Added ${images.length} image${images.length === 1 ? "" : "s"} from Google Drive`,
          description: skipped.length > 0 ? `Skipped ${skipped.length} non-image file${skipped.length === 1 ? "" : "s"}.` : undefined,
          type: "success",
        });
      } else {
        toast.add({ title: "None of the selected files were supported images", type: "error" });
      }
    } catch (err) {
      toast.add({
        title: "Couldn't connect to Google Drive",
        description: err instanceof Error ? err.message : undefined,
        type: "error",
      });
    } finally {
      setPickingFromDrive(false);
    }
  }

  async function processRow(index: number, allRows: Row[]) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, status: "processing" } : r)));

    const row = allRows[index];
    const formData = new FormData();
    formData.set("file", row.file);

    let questionIds: string[] = [];
    let errors: string[] = [];
    let alreadyUploaded = false;
    try {
      if (row.kind === "pdfPage") {
        const result = await raceAgainstSuspendOrTimeout(bulkUploadPdfPageAction(formData));
        questionIds = result.questionIds;
        errors = result.errors;
        alreadyUploaded = result.skipped ?? false;
      } else {
        const result = await raceAgainstSuspendOrTimeout(bulkUploadImageAction(formData));
        if (result.error) errors = [result.error];
        else if (result.questionId) questionIds = [result.questionId];
        alreadyUploaded = result.skipped ?? false;
      }
    } catch (err) {
      const duplicateWarning = "It's possible this still finished on the server after all — check the Questions table before retrying, to avoid creating a duplicate.";
      errors = [
        err instanceof SuspectedSleepError
          ? `This browser tab (or the computer) appears to have been suspended mid-request. ${duplicateWarning}`
          : err instanceof AbsoluteTimeoutError
            ? `This took an unusually long time (over 30 minutes) without a suspend being detected — possibly a genuine server-side issue. ${duplicateWarning}`
            : err instanceof Error
              ? err.message
              : "Something went wrong.",
      ];
    }

    const status: RowStatus = questionIds.length === 0 && errors.length > 0 ? "error" : "done";
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, status, questionIds, errors, alreadyUploaded } : r)));
  }

  // Shared by the initial run, a single row's Retry, and "Retry all failed"
  // — all three are just "run these specific indices through the same
  // concurrency pool." Takes an explicit index list rather than reprocessing
  // every row unconditionally: an earlier version of this function reran
  // *all* rows on every call, which meant clicking Process a second time
  // (e.g. after adding more files to an already-completed batch) would have
  // silently recreated questions for rows that had already succeeded.
  async function runIndices(indices: number[]) {
    if (indices.length === 0 || running) return;
    setRunning(true);
    const snapshot = rows;
    let cursor = 0;
    async function worker() {
      while (cursor < indices.length) {
        const index = indices[cursor++];
        await processRow(index, snapshot);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, indices.length) }, () => worker()));
    setRunning(false);
  }

  function handleStart() {
    void runIndices(rows.flatMap((r, i) => (r.status === "queued" ? [i] : [])));
  }

  function handleRetryRow(index: number) {
    void runIndices([index]);
  }

  function handleRetryAllFailed() {
    void runIndices(rows.flatMap((r, i) => (r.status === "error" ? [i] : [])));
  }

  const queuedCount = rows.filter((r) => r.status === "queued").length;
  const failedCount = rows.filter((r) => r.status === "error").length;
  const doneCount = rows.filter((r) => r.status === "done" || r.status === "error").length;
  const newQuestions = rows.filter((r) => !r.alreadyUploaded).reduce((sum, r) => sum + r.questionIds.length, 0);
  const alreadyUploadedRows = rows.filter((r) => r.alreadyUploaded).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border p-6">
        <p className="mb-4 text-sm text-muted-foreground">
          Category is detected automatically from each question&apos;s content. Question type (multiple choice vs.
          open-ended) is detected the same way — from whether it has answer choices — so a batch can freely mix
          categories and types. Difficulty starts at Medium for every question; set the real difficulty per
          question afterward from its editor (use Next there to move quickly through a batch). A PDF of a full
          test is split page by page, and each page can produce several questions — a question whose text or
          answer choices are cut off across a page boundary is skipped rather than guessed at, so double-check the
          question count against the source PDF.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulkFiles">Question images</Label>
            <input
              id="bulkFiles"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={running || extractingZip || extractingPdf}
              onChange={(e) => {
                handleFilesSelected(e.target.files);
                e.target.value = "";
              }}
              className="text-sm"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulkZip">Or a .zip of images</Label>
            <input
              id="bulkZip"
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              disabled={running || extractingZip || extractingPdf}
              onChange={(e) => {
                void handleZipSelected(e.target.files);
                e.target.value = "";
              }}
              className="text-sm"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulkPdf">Or a PDF of questions</Label>
            <input
              id="bulkPdf"
              type="file"
              accept=".pdf,application/pdf"
              disabled={running || extractingZip || extractingPdf}
              onChange={(e) => {
                void handlePdfSelected(e.target.files);
                e.target.value = "";
              }}
              className="text-sm"
            />
          </div>
        </div>
        {extractingZip && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <FileArchive className="size-4" aria-hidden />
            Extracting images from the zip…
          </p>
        )}
        {extractingPdf && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <FileText className="size-4" aria-hidden />
            Rendering pages from the PDF…
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={!driveAvailable || running || pickingFromDrive}
            onClick={() => void handleDrivePick()}
          >
            <HardDrive className="size-4" aria-hidden />
            {pickingFromDrive ? "Opening Google Drive…" : "Add from Google Drive"}
          </Button>
          {!driveAvailable && (
            <p className="text-xs text-muted-foreground">Google Drive isn&apos;t configured for this environment.</p>
          )}
        </div>

        {rows.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {queuedCount > 0 && (
              <Button onClick={handleStart} disabled={running}>
                {running ? `Processing… (${doneCount}/${rows.length})` : `Process ${queuedCount} item${queuedCount === 1 ? "" : "s"}`}
              </Button>
            )}
            {failedCount > 0 && (
              <Button variant="outline" onClick={handleRetryAllFailed} disabled={running}>
                Retry {failedCount} failed
              </Button>
            )}
            {!running && (
              <Button variant="ghost" onClick={() => setRows([])}>
                Clear all
              </Button>
            )}
            {!running && queuedCount === 0 && failedCount === 0 && rows.length > 0 && (
              <span className="text-sm text-muted-foreground">
                Done — {newQuestions} new question{newQuestions === 1 ? "" : "s"} extracted
                {alreadyUploadedRows > 0
                  ? `, ${alreadyUploadedRows} file${alreadyUploadedRows === 1 ? "" : "s"} already uploaded previously (skipped)`
                  : ""}
                . Review each below.
              </span>
            )}
          </div>
        )}
        {running && (
          <p className="mt-2 text-xs text-muted-foreground">
            &quot;Review&quot; links open in a new tab, so you can review finished questions without losing this
            page&apos;s progress. Closing this tab or navigating away from it directly will stop anything still in
            progress.
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="max-w-48 truncate text-sm">{row.file.name}</TableCell>
                  <TableCell>
                    <RowStatusBadge row={row} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.status === "done" &&
                      (row.questionIds.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {row.alreadyUploaded && (
                            <span className="text-xs text-muted-foreground">
                              Already uploaded previously — no new AI calls made.
                            </span>
                          )}
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {row.questionIds.map((id, qi) => (
                              // Opens in a new tab deliberately — this page keeps
                              // processing the rest of the batch in the background
                              // regardless, but staying on it is the only way to see
                              // that progress; navigating away in the same tab would
                              // strand the Owner with no way back to this batch's status.
                              <Link
                                key={id}
                                href={`/owner/content/questions/${id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                {row.questionIds.length > 1 ? `Review question ${qi + 1} →` : "Review question →"}
                              </Link>
                            ))}
                          </div>
                          {row.errors.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {row.errors.length} question{row.errors.length === 1 ? "" : "s"} on this page couldn&apos;t
                              be processed.
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {row.kind === "pdfPage" ? "No questions found on this page." : "No question found."}
                        </span>
                      ))}
                    {row.status === "error" && (
                      <div className="flex flex-col items-start gap-2">
                        <Alert variant="destructive" className="w-fit">
                          <AlertDescription>{row.errors.join(" ")}</AlertDescription>
                        </Alert>
                        <Button size="sm" variant="outline" disabled={running} onClick={() => handleRetryRow(i)}>
                          Retry
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {rows.length === 0 && (
        <EmptyState
          icon={UploadCloud}
          title="Select images or a PDF to get started"
          description="Select question images, a .zip of them, or a PDF of a full test — category is classified automatically."
        />
      )}
    </div>
  );
}

function RowStatusBadge({ row }: { row: Row }) {
  if (row.status === "queued") return <Badge variant="secondary">Queued</Badge>;
  if (row.status === "processing") return <Badge>Processing…</Badge>;
  if (row.status === "error") return <Badge variant="destructive">Failed</Badge>;
  if (row.alreadyUploaded) return <Badge variant="secondary">Already Uploaded</Badge>;
  if (row.questionIds.length === 0) return <Badge variant="secondary">No questions</Badge>;
  return <Badge>Needs Review</Badge>;
}
