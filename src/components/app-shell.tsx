"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  PencilLine,
  TrendingUp,
  Users,
  UserRound,
  ClipboardList,
  IdCard,
  Megaphone,
  ShieldCheck,
  Building2,
  FileText,
  Settings,
  Menu,
  ArrowUpCircle,
  ArrowRight,
} from "lucide-react";
import { Logo, LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: ComponentType<{ className?: string }> };

const STUDENT_ITEMS: NavItem[] = [
  { href: "/home", label: "Home", icon: LayoutDashboard },
  { href: "/practice", label: "Practice", icon: PencilLine },
  { href: "/progress", label: "Progress", icon: TrendingUp },
  { href: "/community", label: "Community", icon: Users },
  { href: "/settings", label: "Profile", icon: UserRound },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin", label: "Admin Overview", icon: ClipboardList },
  { href: "/admin/students", label: "Student Directory", icon: IdCard },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
  { href: "/admin/access", label: "School Access & Support", icon: ShieldCheck },
];

const OWNER_ITEMS: NavItem[] = [
  { href: "/owner/schools", label: "Schools", icon: Building2 },
  { href: "/owner/users", label: "Users", icon: Users },
  { href: "/owner/content/questions", label: "Content", icon: FileText },
  { href: "/settings", label: "Account", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Routes where an active question (or a short linear flow) should dominate
// the screen instead of competing with a persistent sidebar + nav links —
// the Diagnostic and Practice Session runners, plus the post-signup
// Onboarding wizard. Deliberately exact matches, not prefixes:
// /diagnostic/results and /practice/results/[setId] are review/celebration
// pages, not the focused question flow, so they keep the normal dashboard
// shell. /diagnostic also serves the pre-session intro screens at the same
// URL (see diagnostic/page.tsx) — those get focus mode too, since they're
// part of the same distraction-free flow leading into the first question.
const FOCUS_MODE_PATHS = new Set(["/diagnostic", "/practice/session", "/onboarding"]);

// Second and later sections get a small uppercase label (the reference
// groups its nav the same way). The first never does: for a plain student
// there is only one group, and labelling it "Student" would be noise.
const SECTION_LABELS = ["", "Administrator"];

function NavList({ sections, pathname, onNavigate }: { sections: NavItem[][]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-6">
      {sections.map((items, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {SECTION_LABELS[i] && (
            <p className="mb-1.5 px-3 text-caption font-semibold tracking-[0.12em] text-sidebar-foreground/50 uppercase">
              {SECTION_LABELS[i]}
            </p>
          )}
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                // Pill, matching the CTA shape the rest of the product now
                // uses, rather than the same small rounded rectangle as every
                // other surface in the app. The active item is also the only
                // place the sidebar spends color, so it reads as a position
                // indicator and not as decoration on a list.
                className={cn(
                  "flex items-center gap-2.5 rounded-full px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className={cn("size-4 shrink-0", active && "text-sidebar-primary")} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AppShell({
  role,
  user,
  showUpgrade,
  logoutAction,
  children,
}: {
  role: string;
  user: { name: string; email: string };
  /** Student without paid access: shows the sidebar Upgrade row and the launch-pricing banner. */
  showUpgrade: boolean;
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (FOCUS_MODE_PATHS.has(pathname)) {
    // Onboarding is the one focus route with nowhere to exit *to*: /home
    // redirects a student who hasn't finished the wizard straight back here
    // (see home/page.tsx), so an "Exit" link there is a control that visibly
    // does nothing. Worse, focus mode also drops the sidebar that holds the
    // only Log out button — which left a freshly-signed-up student sealed in
    // with no way out and no way to sign out, on a shared computer included.
    // Log out now lives in this header for every focus route; Exit is hidden
    // on the one route where it can't work.
    const canExit = pathname !== "/onboarding";
    return (
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background/85 px-4 py-3 backdrop-blur-sm">
          {canExit ? (
            <Link
              href="/home"
              className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <LogoMark className="size-6 text-primary" />
              <span>Exit</span>
            </Link>
          ) : (
            <span className="flex items-center gap-2">
              <LogoMark className="size-6 text-primary" />
            </span>
          )}
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
              Log out
            </Button>
          </form>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  const isAdmin = role === "SCHOOL_ADMINISTRATOR";
  const isOwner = role === "OWNER";
  const isStudentExperience = role === "STUDENT" || isAdmin;

  const sections: NavItem[][] = isOwner
    ? [OWNER_ITEMS]
    : isStudentExperience
      ? isAdmin
        ? [STUDENT_ITEMS, ADMIN_ITEMS]
        : [STUDENT_ITEMS]
      : [];

  const initials = (user.name || user.email).trim().slice(0, 2).toUpperCase();

  const sidebarBody = (
    <>
      <div className="flex flex-col gap-8 p-4 pt-5">
        <Link href="/home" className="px-2 transition-opacity hover:opacity-80">
          <Logo tone="inverted" />
        </Link>
        <NavList sections={sections} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
      </div>

      <div className="mt-auto flex flex-col gap-1 p-4">
        {showUpgrade && (
          <Link
            href="/pricing"
            onClick={() => setMobileOpen(false)}
            className="mb-2 flex items-center justify-between gap-3 rounded-full px-3 py-2 text-sm font-medium text-sidebar-primary transition-colors hover:bg-sidebar-accent"
          >
            <span className="flex items-center gap-2.5">
              <ArrowUpCircle className="size-4 shrink-0" aria-hidden />
              Upgrade
            </span>
            <span className="rounded-full bg-sidebar-primary px-2 py-0.5 text-xs font-semibold text-sidebar-primary-foreground">
              50% off
            </span>
          </Link>
        )}

        {/* Account block: who is signed in, with the settings gear as the
            reference has it. The email is the disambiguator on a shared
            computer, which is the same reason Log out stays a visible
            button rather than folding into a menu. */}
        <div className="flex items-center gap-3 border-t border-sidebar-border px-2 pt-4 pb-1">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold"
          >
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name || user.email}</span>
            {user.name && <span className="block truncate text-xs text-sidebar-foreground/60">{user.email}</span>}
          </span>
          <Link
            href="/settings"
            onClick={() => setMobileOpen(false)}
            aria-label="Settings"
            className="rounded-full p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Settings className="size-4" aria-hidden />
          </Link>
        </div>
        <form action={logoutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            Log out
          </Button>
        </form>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — hidden below sm, where the mobile header below takes over */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground sm:flex">
        {sidebarBody}
      </aside>

      {/* Single content column: mobile gets a top bar + slide-out sheet above it,
          desktop hides that bar and relies on the persistent sidebar instead.
          `children` renders exactly once here regardless of viewport — it must
          never be duplicated in the tree, since pages carry real data fetching
          and client state that shouldn't run twice. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Launch-pricing bar, the reference's "sale" strip. No countdown:
            the discount has no announced end date, and a timer that isn't
            real is the one kind of urgency this product must never fake.
            Shown only to students who haven't paid, and it scrolls away
            rather than sticking, so it never crowds a question. */}
        {showUpgrade && (
          <div className="flex items-center justify-center gap-x-4 gap-y-1 bg-marker px-4 py-2 text-sm text-surface-deep">
            <p>
              <span className="font-semibold">Launch pricing</span> — PrepHub Premium is 50% off
            </p>
            <Link
              href="/pricing"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-deep px-3 py-1 text-xs font-semibold text-surface-deep-foreground transition-opacity hover:opacity-90"
            >
              Get 50% off
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </div>
        )}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/85 px-4 py-3 backdrop-blur-sm sm:hidden">
          <Link href="/home" className="flex items-center">
            <LogoMark className="size-6 text-primary" />
          </Link>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="size-5" />
            </Button>
            <SheetContent side="left" className="w-64 bg-sidebar p-0 text-sidebar-foreground">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <div className="flex h-full flex-col">{sidebarBody}</div>
            </SheetContent>
          </Sheet>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
