"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/owner/content/questions", label: "Questions" },
  { href: "/owner/content/families", label: "Question Families" },
  { href: "/owner/content/coverage", label: "Content Coverage" },
  { href: "/owner/content/walkthroughs", label: "Walkthrough Feedback" },
  { href: "/owner/content/curriculum", label: "Curriculum" },
  { href: "/owner/content/supplements", label: "College Supplements" },
];

// PRD-015 §3: three primary pages behind a persistent desktop nav — Questions
// is the default landing page. Role gate already lives in the parent
// /owner layout, so this only needs the nav chrome. Active-state highlight
// matches the sidebar's own pattern (src/components/app-shell.tsx).
export default function OwnerContentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
      {/* Seven tabs don't fit a phone: the row scrolls rather than widening the page. */}
      <nav className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 py-3 whitespace-nowrap sm:px-8">
        <span className="mr-4 shrink-0 font-heading text-sm font-semibold text-muted-foreground">Content</span>
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex-1">{children}</div>
    </div>
  );
}
