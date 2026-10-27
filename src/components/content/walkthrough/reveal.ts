// Scrolling what a walkthrough step changed into view. A step can change
// things in different scroll boxes at once — the passage pane and the
// question pane in a session, a passage box inside a scrolling page — so each
// box is scrolled on its own, only as far as its first change needs, and the
// part of the box hidden under the pinned dock (or the session's footer)
// doesn't count as visible.

export type RevealTarget = Element | Range;

const MARGIN = 12;

function startNode(target: RevealTarget): Node | null {
  return target instanceof Range ? target.startContainer : target;
}

/** The nearest ancestor that actually scrolls; null for the page itself. */
function scrollParent(node: Node | null): HTMLElement | null {
  let el = node instanceof Element ? node.parentElement : (node?.parentElement ?? null);
  while (el && el !== document.body) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return null;
}

/** The part of a scroll box (or the window) the student can actually see. */
function visibleBand(box: HTMLElement | null): { top: number; bottom: number } {
  const frame = box?.getBoundingClientRect();
  let top = frame ? Math.max(frame.top, 0) : 0;
  let bottom = frame ? Math.min(frame.bottom, window.innerHeight) : window.innerHeight;
  // Things pinned over an edge: the app's top bar and the session footer
  // (data-wt-cover), then any dock pinned over the bottom.
  const covers = [...document.querySelectorAll<HTMLElement>("[data-wt-cover]"), ...document.querySelectorAll<HTMLElement>("[data-wt-dock]")];
  for (const cover of covers) {
    const r = cover.getBoundingClientRect();
    if (r.height === 0 || r.width === 0) continue;
    if (box && !box.contains(cover) && cover.hasAttribute("data-wt-dock")) continue;
    if (r.top <= top + 6 && r.bottom > top) top = Math.max(top, r.bottom);
    else if (r.top < bottom && r.bottom >= bottom - 6) bottom = Math.min(bottom, r.top);
  }
  return { top: top + MARGIN, bottom: bottom - MARGIN };
}

function isVisibleIn(rect: DOMRect, band: { top: number; bottom: number }): boolean {
  return rect.bottom > band.top + 8 && rect.top < band.bottom - 8;
}

/** Whether any of the target can be seen right now. */
export function isVisible(target: RevealTarget): boolean {
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return true;
  const box = scrollParent(startNode(target));
  if (!isVisibleIn(rect, visibleBand(box))) return false;
  return box ? isVisible(box) : true;
}

function scrollBox(box: HTMLElement | null, delta: number) {
  if (Math.abs(delta) < 2) return;
  const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (box) box.scrollBy({ top: delta, behavior });
  else window.scrollBy({ top: delta, behavior });
}

function deltaFor(rect: { top: number; bottom: number }, band: { top: number; bottom: number }): number {
  if (rect.top < band.top) return rect.top - band.top;
  if (rect.bottom > band.bottom) return Math.min(rect.bottom - band.bottom, rect.top - band.top);
  return 0;
}

/**
 * Scrolls each box holding targets so all of them are in view together when
 * they fit (a step that rules out A and reveals C shows both), and the first
 * of them when they don't; then the box itself, if it's off screen.
 */
export function revealTargets(targets: RevealTarget[]) {
  const groups = new Map<HTMLElement | null, { top: number; bottom: number; first: DOMRect }>();
  for (const target of targets) {
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const box = scrollParent(startNode(target));
    const group = groups.get(box);
    if (!group) groups.set(box, { top: rect.top, bottom: rect.bottom, first: rect });
    else {
      group.top = Math.min(group.top, rect.top);
      group.bottom = Math.max(group.bottom, rect.bottom);
    }
  }
  const done = new Set<HTMLElement | null>(groups.keys());
  for (const [box, group] of groups) {
    const band = visibleBand(box);
    const fits = group.bottom - group.top <= band.bottom - band.top;
    const span = fits ? { top: group.top, bottom: group.bottom } : group.first;
    scrollBox(box, deltaFor(span, band));
    // A scrolling box that is itself out of sight (a passage box further up
    // a long page) is brought into view in its own parent too.
    if (box) {
      const outer = scrollParent(box);
      if (done.has(outer)) continue;
      const boxRect = box.getBoundingClientRect();
      if (!isVisibleIn(boxRect, visibleBand(outer))) {
        done.add(outer);
        scrollBox(outer, deltaFor(boxRect, visibleBand(outer)));
      }
    }
  }
}
