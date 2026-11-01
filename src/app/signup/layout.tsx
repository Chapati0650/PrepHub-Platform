import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageViewBeacon } from "@/components/analytics/page-view-beacon";
// This page has no per-request server data, so Next.js would otherwise
// statically prerender and CDN-cache it — confirmed live via response
// headers showing a ~1-year Netlify Durable cache TTL. See the matching
// note in src/app/(auth)/layout.tsx for the full reasoning: a cached
// response can serve stale HTML with build-specific Server Action IDs that
// no longer exist, and never reaches middleware's already-authenticated
// redirect at all.
export const dynamic = "force-dynamic";
export const metadata = { title: "Create your account" };

// Already signed in? The landing page's "Start your free Diagnostic" leads
// here, and the landing page can't check (it's prerendered), so this does,
// as the (auth) layout does for /login.
export default async function SignUpLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user?.id) redirect("/home");

  return (
    <>
      <PageViewBeacon />
      {children}
    </>
  );
}
