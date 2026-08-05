import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { logoutAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

// PRD-000's primary nav for students (Home/Practice/Progress/Profile) — also
// shown to School Administrators (PRD-011 §6: "the account receives all
// standard student navigation and an additional administrator-only area"),
// so this creates one unified product rather than separate apps. The Owner
// gets its own short top-level nav here (Schools/Content/Account) — without
// it there was no clickable path out of the bare Owner /home placeholder
// into /owner/schools or /owner/content at all. Once inside /owner/content,
// its own sub-nav (src/app/(app)/owner/content/layout.tsx) handles the
// Questions/Question Families/Content Coverage tabs.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Defense in depth alongside src/middleware.ts — every server-rendered page
  // under (app) independently confirms a session before rendering anything.
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isAdmin = session.user.role === "SCHOOL_ADMINISTRATOR";
  const isOwner = session.user.role === "OWNER";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/85 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-6">
          <Link href="/home" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>
          {canUseStudentExperience(session.user.role) && (
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/home">Home</NavLink>
              <NavLink href="/practice">Practice</NavLink>
              <NavLink href="/progress">Progress</NavLink>
              <NavLink href="/community">Community</NavLink>
              <NavLink href="/settings">Profile</NavLink>
              {isAdmin && (
                <>
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
                  <NavLink href="/admin">Admin Overview</NavLink>
                  <NavLink href="/admin/students">Student Directory</NavLink>
                  <NavLink href="/admin/announcements">Announcements</NavLink>
                  <NavLink href="/admin/access">School Access & Support</NavLink>
                </>
              )}
            </nav>
          )}
          {isOwner && (
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/owner/schools">Schools</NavLink>
              <NavLink href="/owner/content/questions">Content</NavLink>
              <NavLink href="/settings">Account</NavLink>
            </nav>
          )}
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm">
            Log out
          </Button>
        </form>
      </header>
      {children}
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </Link>
  );
}
