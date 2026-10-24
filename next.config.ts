import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static resolves its bundled binary path via __dirname at import
  // time; Next's server bundler rewrites __dirname to a virtual /ROOT/ path
  // for packages it bundles, which breaks that resolution (spawn ENOENT).
  // Excluding it here makes Next use plain Node `require`, preserving the
  // real on-disk path. sharp needs no entry — it's on Next's built-in list.
  serverExternalPackages: ["ffmpeg-static"],

  // Off, because there is no corner left for it. Bottom-left overlapped the
  // sidebar's Log out button (a real e2e failure); it was moved to
  // bottom-right, which since 2026-10-24 sits on the session runner's pinned
  // Next button (another real e2e failure — the badge intercepted the click);
  // the two top corners hold the focus bar's Exit and Log out. Turning the
  // badge off hides only the badge: Next still raises its error overlay for
  // build and runtime errors, which is the part worth not suppressing.
  devIndicators: false,

  // Default Server Action body limit is 1MB — well under a single
  // bulk-uploaded question image, and routinely exceeded by a PDF page
  // rendered at extract-pdf-pages.ts's 180 DPI (confirmed via a real "Body
  // exceeded 1 MB limit" failure during bulk upload). 12mb leaves headroom
  // above transcribe.ts's own IMAGE_MAX_BYTES (10MB) plus multipart/
  // form-data framing overhead, so that app-level check — not this
  // infra-level one — is what actually decides "too large," with a clearer
  // error message than a generic body-size rejection.
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
