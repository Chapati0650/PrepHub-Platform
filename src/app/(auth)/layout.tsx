import { Logo } from "@/components/logo";
import { Marker } from "@/components/ui/marker";

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

// Split shell rather than the previous single card centered on a teal wash.
// That pattern is the default shape of every generated auth screen, and it
// also wasted the one moment a visitor is most receptive: the whole right
// half of the viewport was empty tint. The brand panel now carries the same
// deep-teal block and marker motif as the landing page, so signing in looks
// like the same product the visitor just came from.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="flex flex-1 flex-col px-6 py-10 sm:px-10">
        <Logo size="lg" />
        <div className="flex flex-1 items-center justify-center py-10">
          {/* Every page under (auth) renders a <Card>. Inside the old centered
              shell that chrome was the page; here the panel already provides
              the surface, so a bordered card floating on white is one frame
              too many. Stripped here rather than in four page files so the
              pages stay usable if this shell ever changes again — the same
              [&>div] idiom the previous layout used to add its shadow. */}
          {/* ring-0 matters as much as border-0 here: this Card draws its
              edge with `ring-1 ring-foreground/10`, not a border, so zeroing
              only the border leaves the outline fully visible. */}
          <div className="w-full max-w-sm [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none [&>div]:ring-0">
            {children}
          </div>
        </div>
      </div>

      {/* Decorative and redundant with the form beside it, so it is simply
          dropped below lg rather than stacked — a phone should get the form
          immediately, not a screen of brand copy to scroll past first. */}
      <aside className="hidden bg-surface-deep text-surface-deep-foreground lg:flex lg:w-[42%] lg:max-w-2xl lg:flex-col lg:justify-center lg:px-16">
        <p className="font-heading text-display-sm font-semibold tracking-tight text-balance">
          Every set is built around what you keep <Marker>getting wrong</Marker>.
        </p>
        <p className="mt-6 max-w-md text-lg text-surface-deep-foreground/70">
          One Diagnostic sets your baseline. After that, PrepHub keeps rebuilding your practice
          around the categories costing you the most points.
        </p>
        <div className="mt-12 flex items-center gap-8 border-t border-surface-deep-foreground/15 pt-8">
          <div>
            <p className="font-heading text-2xl font-semibold tabular-nums">8M+</p>
            <p className="text-sm text-surface-deep-foreground/60">Views across PrepHub channels</p>
          </div>
          <div>
            <p className="font-heading text-2xl font-semibold tracking-tight">Brilliant.org</p>
            <p className="text-sm text-surface-deep-foreground/60">Official sponsor</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
