import * as pdfjsLib from "pdfjs-dist";

// Runs entirely in the browser (bulk-upload-form.tsx is a client component)
// — same reasoning as extract-zip-images.ts: by the time processing starts,
// a PDF's rendered pages and a plain multi-select of images are both just
// File[] arrays, so no server-side change was needed to accept them as
// upload input. The worker is loaded from a URL Turbopack resolves at build
// time (the standard pdfjs-dist browser-bundling pattern) rather than
// bundled inline, since it needs to run off the main thread.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// 2.5x scale on a PDF's native 72-DPI point grid ≈ 180 DPI — sharp enough for
// the transcription model to read dense question text/small math notation
// reliably, without producing images so large they blow past IMAGE_MAX_BYTES
// (transcribe.ts) or slow the upload down for no benefit.
const RENDER_SCALE = 2.5;

export type ExtractPdfPagesResult = { pages: File[] };

export async function extractPagesFromPdf(pdfFile: File): Promise<ExtractPdfPagesResult> {
  const arrayBuffer = await pdfFile.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const doc = await loadingTask.promise;

  const baseName = pdfFile.name.replace(/\.pdf$/i, "");
  const pages: File[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: RENDER_SCALE });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      if (!canvas.getContext("2d")) throw new Error("Canvas 2D rendering isn't supported in this browser.");

      await page.render({ canvas, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error(`Couldn't render page ${pageNumber} of the PDF to an image.`);

      pages.push(new File([blob], `${baseName}-page-${pageNumber}.png`, { type: "image/png" }));
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return { pages };
}
