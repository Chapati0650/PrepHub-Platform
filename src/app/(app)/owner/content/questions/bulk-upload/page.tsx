import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getBulkUploadReadiness } from "@/lib/content/ai-readiness";
import { BulkUploadForm } from "./bulk-upload-form";

// Role gate already lives in the parent /owner layout — this page only needs
// its own content. See src/lib/content/bulk-upload.ts for the pipeline this
// drives: transcribe -> classify category -> determine the correct answer ->
// write an explanation, per image, landing every result as a Draft. Review
// before publish is available but no longer required (validation.ts) — the
// Owner can publish immediately and fix mistakes later if needed.
export default function BulkUploadPage() {
  // Read at request time on the server, so the page tells the Owner up
  // front which provider key is missing instead of letting a batch fail
  // one question at a time (see ai-readiness.ts for the incident).
  const readiness = getBulkUploadReadiness();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <Link
        href="/owner/content/questions"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Questions
      </Link>
      <PageHeader
        title="Bulk Upload"
        description="Upload several question images at once. Each one is transcribed, classified by category, given a suggested answer, and explained — ready to review and publish right away."
      />
      {/* AUTH_GOOGLE_ID is an OAuth client id, not a secret — client ids are
          public by design (they end up embedded in every consent-screen URL
          and issued token), so passing it to the client component here for
          the separate Drive-picker consent flow is safe; only the paired
          client *secret* (never referenced here) needs to stay server-only. */}
      {!readiness.ready && (
        <Alert variant="destructive">
          <AlertTitle>Bulk upload is switched off until this environment is configured.</AlertTitle>
          <AlertDescription>
            <p>
              Missing: {readiness.missing.map((m) => `${m.envVar} — used for ${m.usedFor}`).join("; ")}. Every question
              needs both keys, and the image-reading step is billed first — so uploading now would pay Anthropic for
              each image and then fail.
            </p>
            <p className="mt-2">
              On Netlify: Site configuration → Environment variables → add the variable → Deploys → Trigger deploy. A
              variable added after the last build isn&apos;t live until the next one.
            </p>
          </AlertDescription>
        </Alert>
      )}
      <BulkUploadForm googleClientId={process.env.AUTH_GOOGLE_ID ?? null} disabled={!readiness.ready} />
    </div>
  );
}
