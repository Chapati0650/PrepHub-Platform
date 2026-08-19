import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static resolves its bundled binary path via __dirname at import
  // time; Next's server bundler rewrites __dirname to a virtual /ROOT/ path
  // for packages it bundles, which breaks that resolution (spawn ENOENT).
  // Excluding it here makes Next use plain Node `require`, preserving the
  // real on-disk path. sharp needs no entry — it's on Next's built-in list.
  serverExternalPackages: ["ffmpeg-static"],

  // Default bottom-left position overlaps the app shell sidebar's Log out
  // button (also bottom-left, per its own mt-auto placement) — confirmed via
  // a real e2e failure where the indicator's badge intercepted pointer
  // events meant for Log out. Moving it out of that corner is the fix, not
  // suppressing whatever it's flagging.
  devIndicators: {
    position: "bottom-right",
  },

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
