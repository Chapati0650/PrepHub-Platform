"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * The digital SAT's two-pane Reading & Writing layout: passage left,
 * question right, with a divider the student can drag.
 *
 * Only used when a question actually carries a passage. Maths questions and
 * standalone stems render as one column, which is also what the real test
 * does, so this is not a style toggle but a reflection of the content.
 *
 * Below `md` the panes stack rather than splitting. A 60/40 split of a phone
 * screen gives neither side enough width to read, and the real test is not
 * taken on a phone — but ours sometimes is.
 */
export function SplitPane({
  left,
  children,
  hasPassage,
}: {
  left: ReactNode;
  children: ReactNode;
  hasPassage: boolean;
}) {
  const [leftPercent, setLeftPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function startDrag(startEvent: React.PointerEvent<HTMLDivElement>) {
    startEvent.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    function onMove(event: PointerEvent) {
      const rect = container!.getBoundingClientRect();
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      // Clamped so neither pane can be dragged shut, which would strand the
      // content in it with no way back.
      setLeftPercent(Math.min(75, Math.max(25, pct)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // No passage means no split. Returning the question alone keeps a single
  // code path in the runner and means a maths question renders exactly as it
  // did before this component existed. Placed after the hooks so their call
  // order never changes between renders.
  if (!hasPassage) return <>{children}</>;

  return (
    // 20rem is the chrome around the panes: the focus bar, the runner's
    // header, the question strip, the footer and their padding. It was 13rem,
    // which was about 100px short, so the panes pushed the footer off screen.
    <div ref={containerRef} className="flex flex-col md:h-[calc(100dvh-20rem)] md:flex-row">
      {/* Each pane scrolls on its own only once they sit side by side. Stacked
          on a phone the page scrolls, and a pane that is a scroll box without
          a height would trap position: sticky (the walkthrough's dock) inside
          a box that never moves. */}
      <div className="min-w-0 md:overflow-y-auto md:pr-6" style={{ flexBasis: `${leftPercent}%` }}>
        {left}
      </div>

      {/* The divider is a real separator role with keyboard support, not just
          a draggable strip: a student on a keyboard still needs to be able to
          give the passage more room. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize passage and question panes"
        aria-valuenow={Math.round(leftPercent)}
        aria-valuemin={25}
        aria-valuemax={75}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setLeftPercent((p) => Math.max(25, p - 5));
          if (e.key === "ArrowRight") setLeftPercent((p) => Math.min(75, p + 5));
        }}
        className="hidden shrink-0 cursor-col-resize items-center justify-center px-1 focus-visible:outline-2 focus-visible:outline-primary md:flex"
      >
        <span aria-hidden className="h-full w-px bg-foreground/25" />
      </div>

      <div className="mt-6 min-w-0 flex-1 md:mt-0 md:overflow-y-auto md:pl-6">{children}</div>
    </div>
  );
}
