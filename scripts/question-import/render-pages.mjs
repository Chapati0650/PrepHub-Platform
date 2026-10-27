// Renders every page of a PDF to a PNG, for the Claude-run question import
// (see scripts/question-import/README.md).
//
//   node scripts/question-import/render-pages.mjs "<path to test.pdf>" "<output folder>"
//
// Writes <output folder>/page-001.png, page-002.png, … at the same scale the
// website's bulk upload renders at (2.5× PDF points, about 180 DPI —
// src/lib/content/extract-pdf-pages.ts), so a figure cropped from one of these
// pages looks the same as one the site would have cropped.
//
// Rendering runs pdfjs-dist inside headless Chromium, exactly as the site does
// in the browser. pdfjs needs a canvas to draw on, and in Node that would mean
// adding a native canvas package; Chromium already has one. Every request the
// page makes is answered from disk by a route handler, so nothing is served
// over a network and nothing new is installed.

import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RENDER_SCALE = 2.5;
const ORIGIN = "http://question-import.local";

const [pdfPath, outDir] = process.argv.slice(2);
if (!pdfPath || !outDir) {
  console.error('Usage: node scripts/question-import/render-pages.mjs "<test.pdf>" "<output folder>"');
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pdfjsBuild = path.join(repoRoot, "node_modules", "pdfjs-dist", "build");

const files = {
  "/index.html": {
    type: "text/html",
    body: `<!doctype html><meta charset="utf-8"><script type="module">
      import * as pdfjs from "/pdf.min.mjs";
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({ url: "/test.pdf" }).promise;
      window.pageCount = doc.numPages;
      window.renderPage = async (n) => {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: ${RENDER_SCALE} });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        page.cleanup();
        return canvas.toDataURL("image/png").split(",")[1];
      };
      window.ready = true;
    </script>`,
  },
  "/pdf.min.mjs": { type: "text/javascript", file: path.join(pdfjsBuild, "pdf.min.mjs") },
  "/pdf.worker.min.mjs": { type: "text/javascript", file: path.join(pdfjsBuild, "pdf.worker.min.mjs") },
  "/test.pdf": { type: "application/pdf", file: path.resolve(pdfPath) },
};

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (err) => problems.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(msg.text());
  });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const entry = files[new URL(route.request().url()).pathname];
    if (!entry) return route.fulfill({ status: 404, body: "" });
    const body = entry.file ? await readFile(entry.file) : entry.body;
    return route.fulfill({ status: 200, contentType: entry.type, body });
  });
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60_000 }).catch((err) => {
    throw new Error(`The PDF didn't open: ${problems.join(" | ") || err.message}`);
  });
  const count = await page.evaluate(() => window.pageCount);

  for (let n = 1; n <= count; n++) {
    const base64 = await page.evaluate((pageNumber) => window.renderPage(pageNumber), n);
    const name = `page-${String(n).padStart(3, "0")}.png`;
    await writeFile(path.join(outDir, name), Buffer.from(base64, "base64"));
    process.stdout.write(`\rRendered ${n} of ${count}`);
  }
  process.stdout.write(`\nDone: ${count} pages in ${outDir}\n`);
} finally {
  await browser.close();
}
