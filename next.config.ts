import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static resolves its bundled binary path via __dirname at import
  // time; Next's server bundler rewrites __dirname to a virtual /ROOT/ path
  // for packages it bundles, which breaks that resolution (spawn ENOENT).
  // Excluding it here makes Next use plain Node `require`, preserving the
  // real on-disk path. sharp needs no entry — it's on Next's built-in list.
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;
