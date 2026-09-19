import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// The one repeated visual motif on PrepHub's public surfaces: a hand-drawn
// marker stroke under the load-bearing word of a headline.
//
// Why a drawn shape and not `border-bottom` / `text-decoration`: a perfectly
// uniform 4px rule reads as a browser default, which is exactly the
// machine-made quality this is meant to break. The path below is a filled
// band whose two edges are drawn with slightly different curves, so the
// stroke is thicker through the middle and tapers unevenly at each end the
// way a real marker does. It renders behind the text (`-z-10` on the svg, not
// a stacking trick on the text) so descenders stay fully legible.
//
// Deliberately stretched with preserveAspectRatio="none": the stroke spans
// whatever the word's width is, so the ends always land with the glyphs. That
// does squash the curve on very short words, which is fine and even helps —
// no two instances on a page end up identical, which is the point.
export function Marker({
  children,
  className,
  strokeClassName,
}: {
  children: ReactNode;
  className?: string;
  /** Override the stroke color/size — defaults to the brand marker cyan. */
  strokeClassName?: string;
}) {
  return (
    // `inline`, deliberately, not `inline-block` — and this is an
    // accessibility fix, not a style preference. The accessible-name
    // algorithm appends a space around any node whose computed display isn't
    // inline, so an inline-block wrapper turned every
    // `<Marker>ready</Marker>.` heading into the name "… is ready ." with a
    // space before the punctuation. Caught by a Playwright role-name query
    // that could no longer find its own heading; it affected every marked
    // headline in the app.
    //
    // `whitespace-nowrap` restores the one thing inline-block was buying us:
    // an atomic phrase that can't break across two lines and leave the stroke
    // spanning a line break.
    <span className={cn("relative inline whitespace-nowrap", className)}>
      {/* Painted first, and the text below is itself positioned, so the stroke
          lands under the glyphs purely by paint order. A negative z-index
          would be the obvious alternative but is a real bug here: `relative`
          with no z-index creates no stacking context, so -z-10 escapes to the
          root and hides the stroke behind the section's own background.
          aria-hidden also keeps this node out of the name computation
          entirely, so it contributes no stray whitespace of its own. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 200 14"
        preserveAspectRatio="none"
        className={cn(
          "absolute inset-x-0 -bottom-[0.06em] h-[0.3em] w-full text-marker",
          strokeClassName,
        )}
      >
        <path
          d="M2 8.6C44 3.6 94 2.1 142 3.3c25 .7 43 1.9 56 3.2l-.6 5.2c-13-1.3-31-2.4-56-2.9-48-1-98 .5-139 4.4Z"
          fill="currentColor"
        />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}
