// This page has no per-request server data, so Next.js would otherwise
// statically prerender and CDN-cache it — confirmed live via response
// headers showing a ~1-year Netlify Durable cache TTL. See the matching
// note in src/app/(auth)/layout.tsx for the full reasoning: a cached
// response can serve stale HTML with build-specific Server Action IDs that
// no longer exist, and never reaches middleware's already-authenticated
// redirect at all.
export const dynamic = "force-dynamic";

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
