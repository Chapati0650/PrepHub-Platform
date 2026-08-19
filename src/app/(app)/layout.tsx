import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logoutAction } from "./actions";
import { AppShell } from "@/components/app-shell";

// PRD-000's primary nav for students (Home/Practice/Progress/Profile) — also
// shown to School Administrators (PRD-011 §6: "the account receives all
// standard student navigation and an additional administrator-only area"),
// so this creates one unified product rather than separate apps. The Owner
// gets its own short nav (Schools/Content/Account) — without it there was no
// clickable path out of the bare Owner /home placeholder into /owner/schools
// or /owner/content at all. Once inside /owner/content, its own sub-nav
// (src/app/(app)/owner/content/layout.tsx) handles the Questions/Question
// Families/Content Coverage tabs. The actual nav chrome (persistent left
// sidebar on desktop, slide-out sheet on mobile) lives in AppShell — a
// client component, since active-link highlighting needs usePathname() —
// this file stays a server component so the session check happens here.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Defense in depth alongside src/middleware.ts — every server-rendered page
  // under (app) independently confirms a session before rendering anything.
  // Checks session.user.id specifically, not just the bare session.user
  // object: a just-deleted account's jwt callback returns an empty token
  // (see src/auth.ts), which Auth.js still surfaces as a truthy — but
  // id-less — session.user for that one stale request. Every child page's
  // own data fetch assumes session.user.id is a real, queryable id, so this
  // must catch the id-less case, not just an absent session (see the same
  // pattern in src/app/page.tsx).
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <AppShell role={session.user.role ?? "STUDENT"} logoutAction={logoutAction}>
      {children}
    </AppShell>
  );
}
