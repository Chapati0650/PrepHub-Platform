import Link from "next/link";

// PRD-015 §3: three primary pages behind a persistent desktop nav — Questions
// is the default landing page. Role gate already lives in the parent
// /owner layout, so this only needs the nav chrome.
export default function OwnerContentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <nav className="flex items-center gap-6 border-b border-border px-8 py-4">
        <span className="font-heading text-sm font-semibold text-muted-foreground">Content</span>
        <Link href="/owner/content/questions" className="text-sm font-medium hover:underline">
          Questions
        </Link>
        <Link href="/owner/content/families" className="text-sm font-medium hover:underline">
          Question Families
        </Link>
        <Link href="/owner/content/coverage" className="text-sm font-medium hover:underline">
          Content Coverage
        </Link>
      </nav>
      <div className="flex-1">{children}</div>
    </div>
  );
}
