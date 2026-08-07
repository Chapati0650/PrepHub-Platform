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
  { href: "/owner/content/questions", label: "Content", icon: FileText },
  { href: "/settings", label: "Account", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ sections, pathname, onNavigate }: { sections: NavItem[][]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4">
      {sections.map((items, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
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
  logoutAction,
  children,
}: {
  role: string;
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const sidebarBody = (
    <>
      <div className="flex flex-col gap-6 p-4">
        <Link href="/home" className="px-1 transition-opacity hover:opacity-80">
          <Logo />
        </Link>
        <NavList sections={sections} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
      </div>
      <form action={logoutAction} className="mt-auto p-4">
        <Button type="submit" variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
          Log out
        </Button>
      </form>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — hidden below sm, where the mobile header below takes over */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar sm:flex">
        {sidebarBody}
      </aside>

      {/* Single content column: mobile gets a top bar + slide-out sheet above it,
          desktop hides that bar and relies on the persistent sidebar instead.
          `children` renders exactly once here regardless of viewport — it must
          never be duplicated in the tree, since pages carry real data fetching
          and client state that shouldn't run twice. */}
      <div className="flex min-w-0 flex-1 flex-col">
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
