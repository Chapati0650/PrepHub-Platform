import Link, { type LinkProps } from "next/link"
import type { AnchorHTMLAttributes, ReactNode } from "react"
import type { VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { buttonVariants } from "./button"

// A button-styled navigation link. Deliberately a plain `<Link>` with
// `buttonVariants` classes — not `<Button render={<Link .../>} />` — because
// Base UI's Button widget always injects either `type="button"` (nativeButton
// default true, harmless but logs a console warning since the rendered tag
// isn't really a <button>) or explicit `role="button"` (nativeButton=false,
// which overrides the anchor's correct implicit `role="link"` and would make
// screen readers announce a link as a button). A real <a> already has
// correct link semantics for free — keyboard, screen readers, right-click
// "open in new tab" — so wrapping it in a button widget only fights that.
// Use this for every "styled like a button, navigates like a link" case;
// reserve <Button> itself for real actions (onClick handlers, form submits).
export function LinkButton({
  className,
  variant,
  size,
  children,
  hardNavigation,
  ...props
}: LinkProps &
  Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel" | "aria-label"> &
  VariantProps<typeof buttonVariants> & {
    className?: string
    children?: ReactNode
    // Forces a real browser navigation instead of next/link's client-side
    // fetch()-based soft nav. Needed wherever the target might itself
    // redirect again server-side (middleware's already-authenticated bounce,
    // a stale-session check further down the chain, etc.) — confirmed live
    // as a real bug: a multi-hop redirect chain silently produced a blank
    // page when followed via soft nav, while the exact same chain works
    // correctly and instantly as a sequence of real HTTP round trips. Use
    // for any landing-page entry point into the auth flow.
    hardNavigation?: boolean
  }) {
  if (hardNavigation) {
    const { href, ...anchorProps } = props
    return (
      <a
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        href={typeof href === "string" ? href : (href.pathname ?? undefined)}
        {...anchorProps}
      >
        {children}
      </a>
    )
  }
  return (
    <Link data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props}>
      {children}
    </Link>
  )
}
