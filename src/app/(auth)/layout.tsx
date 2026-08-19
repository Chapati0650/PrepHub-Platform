import { Logo } from "@/components/logo";

// These pages have no per-request server data, so Next.js would otherwise
// statically prerender and CDN-cache them — confirmed live via response
// headers showing a ~1-year Netlify Durable cache TTL on /login and
// /reset-password. That let visitors get served stale HTML from a previous
// deploy, including Server Action IDs that no longer exist in the current
// build (Server Action IDs are build-specific) and skipping middleware's
// already-authenticated redirect entirely, since a cached response never
// reaches the request pipeline at all. force-dynamic makes every request
// render fresh.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-accent/30 p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <Logo size="lg" />
        <div className="w-full [&>div]:shadow-lg">{children}</div>
      </div>
    </div>
  );
}
