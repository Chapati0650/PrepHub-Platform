// Where to put a figure's labels so they don't sit on each other, on an
// axis's numbers, or across the line they name. Each label has a short list
// of acceptable spots in order of preference (beside its point, along its
// line); it takes the first one that's clear, or the least crowded, and then
// becomes something the next label must keep clear of. Pure, so it's tested
// without a browser; the widths come from labelWidth's estimate.

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Anchor = "start" | "middle" | "end";
export type Spot = { x: number; y: number; anchor: Anchor };
type Pt = [number, number];

/** The box a label of `width` covers when its text starts, centres or ends at x with its baseline at y. */
export function textBox(spot: Spot, width: number, fontSize: number): Box {
  const x0 = spot.anchor === "start" ? spot.x : spot.anchor === "end" ? spot.x - width : spot.x - width / 2;
  return { x0, x1: x0 + width, y0: spot.y - fontSize * 0.8, y1: spot.y + fontSize * 0.24 };
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** A spot `distance` from p in the direction (dx, dy), its text anchored and its baseline set so the text sits on that side. */
export function spotToward(p: Pt, [dx, dy]: Pt, distance: number, fontSize: number): Spot {
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const anchor: Anchor = ux > 0.35 ? "start" : ux < -0.35 ? "end" : "middle";
  const baseline = uy > 0.35 ? fontSize * 0.78 : uy < -0.35 ? -fontSize * 0.08 : fontSize * 0.32;
  return { x: p[0] + ux * distance, y: p[1] + uy * distance + baseline, anchor };
}

/** Points every `step` units along a polyline, for keeping labels off it. */
export function samplePath(points: Pt[], step = 5): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  if (points.length > 0) out.push(points[points.length - 1]);
  return out;
}

/** The point a fraction `t` of the way along a polyline, and the direction it runs there. */
export function alongPath(points: Pt[], t: number): { at: Pt; dir: Pt } {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let goal = total * Math.max(0, Math.min(1, t));
  for (let i = 0; i < lengths.length; i++) {
    if (goal <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] ? Math.min(1, goal / lengths[i]) : 0;
      const [a, b] = [points[i], points[i + 1]];
      return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], dir: [b[0] - a[0], b[1] - a[1]] };
    }
    goal -= lengths[i];
  }
  return { at: points[0] ?? [0, 0], dir: [1, 0] };
}

export class LabelPlacer {
  private boxes: Box[] = [];
  private samples: Pt[] = [];

  constructor(private bounds: Box) {}

  /** Something labels must keep clear of: a tick label, an axis, a fixed label, a point's dot. */
  block(box: Box): void {
    this.boxes.push(box);
  }

  /** A drawn line, as sample points; a label lying across it scores badly. */
  blockPath(points: Pt[]): void {
    this.samples.push(...samplePath(points));
  }

  private cost(box: Box, preference: number): number {
    let cost = preference * 6;
    for (const b of this.boxes) cost += overlapArea(box, b);
    const pad = 1.5;
    for (const [x, y] of this.samples) {
      if (x > box.x0 - pad && x < box.x1 + pad && y > box.y0 - pad && y < box.y1 + pad) cost += 45;
    }
    const outside =
      Math.max(0, this.bounds.x0 - box.x0) + Math.max(0, box.x1 - this.bounds.x1) + Math.max(0, this.bounds.y0 - box.y0) + Math.max(0, box.y1 - this.bounds.y1);
    return cost + outside * 400;
  }

  /** The best of `spots` for a label this wide; it then blocks that spot for the labels placed after it. */
  place(spots: Spot[], width: number, fontSize: number): Spot {
    let best = spots[0];
    let bestCost = Infinity;
    spots.forEach((spot, i) => {
      const cost = this.cost(textBox(spot, width, fontSize), i);
      if (cost < bestCost) {
        best = spot;
        bestCost = cost;
      }
    });
    this.block(textBox(best, width, fontSize));
    return best;
  }
}
