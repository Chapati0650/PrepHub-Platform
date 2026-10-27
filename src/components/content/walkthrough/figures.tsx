import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { BarsState, ElementsState, Panel } from "@/lib/content/walkthrough";
import { SvgLabelText } from "./svg-label";

// The walkthrough's drawn panels: a coordinate plane, a free diagram, a
// number line and a bar chart. All plain SVG in the app's own tokens
// (stroke-foreground, primary for "look here"), so they follow the theme and
// need no charting library. When a step focuses some elements the rest dim,
// which is most of what makes a step read at a glance; an element a step
// reveals fades or draws in, behind motion-safe.
//
// Every label carries a halo: a stroke in the stage's own background colour
// painted under the text (paint-order: stroke), so a label that lands on a
// grid line or an axis stays readable instead of being struck through.

type PlanePanel = Extract<Panel, { type: "plane" }>;
type DiagramPanel = Extract<Panel, { type: "diagram" }>;
type NumberLinePanel = Extract<Panel, { type: "numberline" }>;
type BarsPanel = Extract<Panel, { type: "bars" }>;
type Pt = [number, number];

/** 1, 2 or 5 × 10^k, giving about `target` intervals across a range. */
export function niceStep(range: number, target = 10): number {
  const raw = range / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

function ticks(low: number, high: number, step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(low / step - 1e-9);
  for (let i = first; i * step <= high + 1e-9; i++) out.push(Math.round(i * step * 1e9) / 1e9);
  return out;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n).replace("-", "−") : String(Math.round(n * 100) / 100).replace("-", "−");
}

/** The part of the infinite line through p in direction d that lies in the box, as parameters [t0, t1]. */
export function clipLine(p: Pt, d: Pt, [x0, x1]: Pt, [y0, y1]: Pt): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [start, dir, lo, hi] of [
    [p[0], d[0], x0, x1],
    [p[1], d[1], y0, y1],
  ] as const) {
    if (Math.abs(dir) < 1e-12) {
      if (start < lo || start > hi) return null;
      continue;
    }
    const a = (lo - start) / dir;
    const b = (hi - start) / dir;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 ? [t0, t1] : null;
}

function emphasis(id: string, state: ElementsState) {
  const focused = state.focus.has(id);
  return { focused, dimmed: state.focus.size > 0 && !focused, appeared: state.appeared.has(id) };
}

const INK = "stroke-foreground";
const LOOK = "stroke-primary";

/** The halo under a label, sized to its font. */
function halo(fontSize: number): { stroke: string; strokeWidth: number; strokeLinejoin: "round"; style: CSSProperties } {
  return {
    stroke: "var(--wt-surface, var(--background))",
    strokeWidth: fontSize * 0.3,
    strokeLinejoin: "round",
    style: { paintOrder: "stroke" },
  };
}

function drawn(appeared: boolean, dashed?: boolean) {
  // A drawn-in line needs pathLength="1" with a dash pattern of 1; a dashed
  // line keeps its own pattern and fades in instead.
  if (!appeared) return {};
  return dashed
    ? { className: "motion-safe:animate-wt-appear" }
    : { pathLength: 1, strokeDasharray: 1, className: "motion-safe:animate-wt-draw" };
}

// ---------------------------------------------------------------------------

export function PlaneFigure({ panel, state }: { panel: PlanePanel; state: ElementsState }) {
  const [x0, x1] = panel.x;
  const [y0, y1] = panel.y;
  // Drawn at 360 units wide: in a half-width column that is close to 1:1,
  // so the 13–15 unit labels stay readable on a laptop and a phone.
  const W = 360;
  const padL = 34;
  const padR = 14;
  const padT = 16;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = plotW * Math.min(1.15, Math.max(0.55, (y1 - y0) / (x1 - x0)));
  const H = plotH + padT + padB;
  const X = (x: number) => padL + ((x - x0) / (x1 - x0)) * plotW;
  const Y = (y: number) => padT + ((y1 - y) / (y1 - y0)) * plotH;

  const tickX = panel.tick ?? niceStep(x1 - x0);
  const tickY = panel.tick ?? niceStep(y1 - y0);
  const labelX = panel.labelEvery ?? niceStep(x1 - x0, 6);
  const labelY = panel.labelEvery ?? niceStep(y1 - y0, 6);
  const axisX = y0 <= 0 && y1 >= 0 ? Y(0) : Y(y0);
  const axisY = x0 <= 0 && x1 >= 0 ? X(0) : X(x0);
  const originInView = x0 <= 0 && x1 >= 0 && y0 <= 0 && y1 >= 0;
  const clipId = `wt-plane-${panel.id ?? "plane"}`;

  const visible = panel.elements.filter((e) => state.visible.has(e.id));
  const order = { region: 0, line: 1, curve: 1, segment: 1, point: 2, label: 3 } as const;
  visible.sort((a, b) => order[a.kind] - order[b.kind]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block h-auto w-full max-w-[30rem]" role="img" aria-label="Coordinate plane">
      <defs>
        <clipPath id={clipId}>
          <rect x={padL} y={padT} width={plotW} height={plotH} />
        </clipPath>
        <marker id={`${clipId}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-foreground" />
        </marker>
      </defs>

      {ticks(x0, x1, tickX).map((v) => (
        <line key={`gx${v}`} x1={X(v)} x2={X(v)} y1={padT} y2={padT + plotH} className="stroke-foreground/10" strokeWidth={1} />
      ))}
      {ticks(y0, y1, tickY).map((v) => (
        <line key={`gy${v}`} y1={Y(v)} y2={Y(v)} x1={padL} x2={padL + plotW} className="stroke-foreground/10" strokeWidth={1} />
      ))}
      <line x1={padL} x2={padL + plotW} y1={axisX} y2={axisX} className={INK} strokeWidth={1.4} />
      <line y1={padT} y2={padT + plotH} x1={axisY} x2={axisY} className={INK} strokeWidth={1.4} />
      {ticks(x0, x1, labelX)
        .filter((v) => v !== 0 || !originInView)
        .map((v) => (
          <text key={`lx${v}`} x={X(v)} y={axisX + 17} textAnchor="middle" fontSize={13} className="fill-muted-foreground" {...halo(13)}>
            {fmt(v)}
          </text>
        ))}
      {ticks(y0, y1, labelY)
        .filter((v) => v !== 0 || !originInView)
        .map((v) => (
          <text key={`ly${v}`} x={axisY - 6} y={Y(v) + 4} textAnchor="end" fontSize={13} className="fill-muted-foreground" {...halo(13)}>
            {fmt(v)}
          </text>
        ))}
      {originInView && (
        <text x={axisY - 6} y={axisX + 17} textAnchor="end" fontSize={13} fontStyle="italic" className="fill-muted-foreground" {...halo(13)}>
          O
        </text>
      )}
      <text x={padL + plotW} y={axisX - 6} textAnchor="end" fontSize={15} className="fill-foreground" {...halo(15)}>
        <SvgLabelText label={panel.xLabel ?? "$x$"} />
      </text>
      <text x={axisY + 6} y={padT + 10} fontSize={15} className="fill-foreground" {...halo(15)}>
        <SvgLabelText label={panel.yLabel ?? "$y$"} />
      </text>

      <g clipPath={`url(#${clipId})`}>
        {visible.map((e) => {
          const { focused, dimmed, appeared } = emphasis(e.id, state);
          const tone = cn(focused ? LOOK : INK, dimmed && "opacity-35", "transition-opacity duration-300");
          const width = focused ? 3.2 : 2.2;
          switch (e.kind) {
            case "region":
              return (
                <polygon
                  key={e.id}
                  points={e.points.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}
                  className={cn(focused ? "fill-primary/30" : "fill-primary/15", dimmed && "opacity-40", appeared && "motion-safe:animate-wt-appear")}
                />
              );
            case "line": {
              const [p, q] = e.through;
              const d: Pt = [q[0] - p[0], q[1] - p[1]];
              const t = clipLine(p, d, panel.x, panel.y);
              if (!t) return null;
              const a: Pt = [p[0] + d[0] * t[0], p[1] + d[1] * t[0]];
              const b: Pt = [p[0] + d[0] * t[1], p[1] + d[1] * t[1]];
              return (
                <line
                  key={e.id}
                  x1={X(a[0])}
                  y1={Y(a[1])}
                  x2={X(b[0])}
                  y2={Y(b[1])}
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeDasharray={e.dashed ? "6 5" : undefined}
                  {...drawn(appeared, e.dashed)}
                  className={cn(tone, drawn(appeared, e.dashed).className)}
                />
              );
            }
            case "segment":
              return (
                <line
                  key={e.id}
                  x1={X(e.from[0])}
                  y1={Y(e.from[1])}
                  x2={X(e.to[0])}
                  y2={Y(e.to[1])}
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeDasharray={e.dashed ? "6 5" : undefined}
                  markerEnd={e.arrow ? `url(#${clipId}-arrow)` : undefined}
                  {...drawn(appeared, e.dashed)}
                  className={cn(tone, drawn(appeared, e.dashed).className)}
                />
              );
            case "curve":
              return (
                <polyline
                  key={e.id}
                  points={e.points.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}
                  fill="none"
                  strokeWidth={width}
                  strokeLinejoin="round"
                  strokeDasharray={e.dashed ? "6 5" : undefined}
                  {...drawn(appeared, e.dashed)}
                  className={cn(tone, drawn(appeared, e.dashed).className)}
                />
              );
            default:
              return null;
          }
        })}
      </g>

      {visible.map((e) => {
        const { focused, dimmed, appeared } = emphasis(e.id, state);
        const textTone = cn(focused ? "fill-primary font-semibold" : "fill-foreground", dimmed && "opacity-55");
        const pop = appeared ? "motion-safe:animate-wt-appear [transform-box:fill-box] origin-center" : undefined;
        if (e.kind === "point") {
          const px = X(e.at[0]);
          const py = Y(e.at[1]);
          const right = px > padL + plotW * 0.72;
          return (
            <g key={e.id} className={cn(dimmed && "opacity-40", "transition-opacity duration-300")}>
              {focused && <circle cx={px} cy={py} r={11} className="fill-primary/20" />}
              <circle cx={px} cy={py} r={focused ? 5.5 : 4.5} className={cn(focused ? "fill-primary" : "fill-foreground", pop)} />
              {e.label && (
                <text x={px + (right ? -9 : 9)} y={py - 9} textAnchor={right ? "end" : "start"} fontSize={15} className={textTone} {...halo(15)}>
                  <SvgLabelText label={e.label} />
                </text>
              )}
            </g>
          );
        }
        if (e.kind === "label") {
          return (
            <text key={e.id} x={X(e.at[0])} y={Y(e.at[1])} textAnchor="middle" fontSize={15} className={cn(textTone, pop)} {...halo(15)}>
              <SvgLabelText label={e.text} />
            </text>
          );
        }
        if ((e.kind === "line" || e.kind === "segment" || e.kind === "curve") && e.label) {
          let at: Pt;
          if (e.kind === "segment") at = e.to;
          else if (e.kind === "curve") at = e.points[e.points.length - 1];
          else {
            const [p, q] = e.through;
            const d: Pt = [q[0] - p[0], q[1] - p[1]];
            const t = clipLine(p, d, panel.x, panel.y);
            if (!t) return null;
            const s = t[0] + (t[1] - t[0]) * 0.86;
            at = [p[0] + d[0] * s, p[1] + d[1] * s];
          }
          // Toward the right edge the label hangs to the left of its anchor,
          // so it never runs out of the plot.
          const right = X(at[0]) > padL + plotW * 0.55;
          return (
            <text
              key={`${e.id}-label`}
              x={X(at[0]) + (right ? -8 : 8)}
              y={Y(at[1]) - 8}
              textAnchor={right ? "end" : "start"}
              fontSize={15}
              className={textTone}
              {...halo(15)}
            >
              <SvgLabelText label={e.label} />
            </text>
          );
        }
        return null;
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

const COMPASS: Record<string, Pt> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [0.75, -0.75],
  nw: [-0.75, -0.75],
  se: [0.75, 0.75],
  sw: [-0.75, 0.75],
};

function anchorFor([dx]: Pt): "start" | "middle" | "end" {
  return dx > 0.3 ? "start" : dx < -0.3 ? "end" : "middle";
}

export function DiagramFigure({ panel, state }: { panel: DiagramPanel; state: ElementsState }) {
  const size = Math.max(panel.width, panel.height);
  const margin = size * 0.1;
  const font = size * 0.064;
  const dot = size * 0.014;
  const gap = size * 0.05;
  const visible = panel.elements.filter((e) => state.visible.has(e.id));
  const order = { polygon: 0, circle: 0, segment: 1, angle: 2, point: 3, label: 4 } as const;
  visible.sort((a, b) => order[a.kind] - order[b.kind]);
  const arrowId = `wt-diagram-${panel.id ?? "diagram"}-arrow`;

  return (
    <svg
      viewBox={`${-margin} ${-margin} ${panel.width + 2 * margin} ${panel.height + 2 * margin}`}
      className="mx-auto block h-auto w-full max-w-[28rem]"
      role="img"
      aria-label="Diagram"
    >
      <defs>
        <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-foreground" />
        </marker>
      </defs>
      {visible.map((e) => {
        const { focused, dimmed, appeared } = emphasis(e.id, state);
        const stroke = cn(focused ? LOOK : INK, dimmed && "opacity-35", "transition-opacity duration-300");
        const text = cn(focused ? "fill-primary font-semibold" : "fill-foreground", dimmed && "opacity-55");
        const width = focused ? 3.2 : 2;
        const pop = appeared ? "motion-safe:animate-wt-appear [transform-box:fill-box] origin-center" : undefined;
        switch (e.kind) {
          case "polygon":
            return (
              <polygon
                key={e.id}
                points={e.points.map((p) => p.join(",")).join(" ")}
                strokeWidth={width}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                className={cn(stroke, e.filled || focused ? (focused ? "fill-primary/15" : "fill-foreground/5") : "fill-none", pop)}
              />
            );
          case "circle":
            return (
              <circle
                key={e.id}
                cx={e.center[0]}
                cy={e.center[1]}
                r={e.r}
                strokeWidth={width}
                vectorEffect="non-scaling-stroke"
                className={cn(
                  stroke,
                  e.cutout ? "fill-[var(--wt-surface,var(--background))]" : e.filled ? (focused ? "fill-primary/15" : "fill-foreground/5") : "fill-none",
                  pop,
                )}
              />
            );
          case "segment": {
            const mid: Pt = [(e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2];
            const len = Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) || 1;
            const normal: Pt = [-(e.to[1] - e.from[1]) / len, (e.to[0] - e.from[0]) / len];
            return (
              <g key={e.id}>
                <line
                  x1={e.from[0]}
                  y1={e.from[1]}
                  x2={e.to[0]}
                  y2={e.to[1]}
                  strokeWidth={width}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeDasharray={e.dashed ? `${size * 0.02} ${size * 0.016}` : undefined}
                  markerEnd={e.arrow ? `url(#${arrowId})` : undefined}
                  markerStart={e.arrow === "both" ? `url(#${arrowId})` : undefined}
                  {...drawn(appeared, e.dashed)}
                  className={cn(stroke, drawn(appeared, e.dashed).className)}
                />
                {e.label && (
                  <text
                    x={mid[0] + normal[0] * gap}
                    y={mid[1] + normal[1] * gap + font * 0.35}
                    textAnchor="middle"
                    fontSize={font}
                    className={text}
                    {...halo(font)}
                  >
                    <SvgLabelText label={e.label} />
                  </text>
                )}
              </g>
            );
          }
          case "angle": {
            const r = e.radius ?? size * 0.08;
            const u = (p: Pt): Pt => {
              const l = Math.hypot(p[0] - e.vertex[0], p[1] - e.vertex[1]) || 1;
              return [(p[0] - e.vertex[0]) / l, (p[1] - e.vertex[1]) / l];
            };
            const a = u(e.from);
            const b = u(e.to);
            const bis: Pt = [a[0] + b[0], a[1] + b[1]];
            const bl = Math.hypot(bis[0], bis[1]) || 1;
            const labelAt: Pt = [e.vertex[0] + (bis[0] / bl) * r * 1.9, e.vertex[1] + (bis[1] / bl) * r * 1.9];
            let mark: ReactNode;
            if (e.right) {
              const s = r * 0.7;
              mark = (
                <polyline
                  points={[
                    [e.vertex[0] + a[0] * s, e.vertex[1] + a[1] * s],
                    [e.vertex[0] + (a[0] + b[0]) * s, e.vertex[1] + (a[1] + b[1]) * s],
                    [e.vertex[0] + b[0] * s, e.vertex[1] + b[1] * s],
                  ]
                    .map((p) => p.join(","))
                    .join(" ")}
                  fill="none"
                  strokeWidth={focused ? 2.6 : 1.6}
                  vectorEffect="non-scaling-stroke"
                  className={stroke}
                />
              );
            } else {
              const cross = a[0] * b[1] - a[1] * b[0];
              mark = (
                <path
                  d={`M ${e.vertex[0] + a[0] * r} ${e.vertex[1] + a[1] * r} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${e.vertex[0] + b[0] * r} ${e.vertex[1] + b[1] * r}`}
                  fill="none"
                  strokeWidth={focused ? 2.6 : 1.6}
                  vectorEffect="non-scaling-stroke"
                  className={cn(stroke, focused && "fill-primary/15")}
                />
              );
            }
            return (
              <g key={e.id} className={pop}>
                {mark}
                {e.label && (
                  <text x={labelAt[0]} y={labelAt[1] + font * 0.35} textAnchor="middle" fontSize={font} className={text} {...halo(font)}>
                    <SvgLabelText label={e.label} />
                  </text>
                )}
              </g>
            );
          }
          case "point": {
            const dir = COMPASS[e.labelAt ?? "ne"];
            return (
              <g key={e.id} className={cn(dimmed && "opacity-55")}>
                <circle cx={e.at[0]} cy={e.at[1]} r={focused ? dot * 1.4 : dot} className={cn(focused ? "fill-primary" : "fill-foreground", pop)} />
                {e.label && (
                  <text
                    x={e.at[0] + dir[0] * gap}
                    y={e.at[1] + dir[1] * gap + font * 0.35}
                    textAnchor={anchorFor(dir)}
                    fontSize={font}
                    className={text}
                    {...halo(font)}
                  >
                    <SvgLabelText label={e.label} />
                  </text>
                )}
              </g>
            );
          }
          case "label":
            return (
              <text key={e.id} x={e.at[0]} y={e.at[1] + font * 0.35} textAnchor="middle" fontSize={font} className={cn(text, pop)} {...halo(font)}>
                <SvgLabelText label={e.text} />
              </text>
            );
        }
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export function NumberLineFigure({ panel, state }: { panel: NumberLinePanel; state: ElementsState }) {
  const W = 420;
  // Distances are drawn as dimension lines above the labels, so a line that
  // has any keeps a band of room above it for them.
  const hasSpans = panel.elements.some((e) => e.kind === "span");
  const lift = hasSpans ? 34 : 0;
  const H = 86 + lift;
  const pad = 24;
  const lineY = 50 + lift;
  const spanY = lineY - 40;
  const X = (v: number) => pad + ((v - panel.min) / (panel.max - panel.min)) * (W - 2 * pad);
  const step = panel.tick ?? niceStep(panel.max - panel.min, 10);
  const labels = ticks(panel.min, panel.max, step);
  const labelEvery = labels.length > 12 ? 2 : 1;
  const arrowId = `wt-numberline-${panel.id ?? "numberline"}-arrow`;
  const visible = panel.elements.filter((e) => state.visible.has(e.id));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block h-auto w-full max-w-[30rem]" role="img" aria-label="Number line">
      <defs>
        <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-foreground" />
        </marker>
        <marker id={`${arrowId}-look`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-primary" />
        </marker>
        <marker id={`${arrowId}-ink`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-foreground" />
        </marker>
      </defs>
      <line x1={pad - 12} x2={W - pad + 12} y1={lineY} y2={lineY} strokeWidth={1.5} className={INK} markerEnd={`url(#${arrowId})`} markerStart={`url(#${arrowId})`} />
      {labels.map((v, i) => (
        <g key={v}>
          <line x1={X(v)} x2={X(v)} y1={lineY - 5} y2={lineY + 5} strokeWidth={1.2} className={INK} />
          {i % labelEvery === 0 && (
            <text x={X(v)} y={lineY + 24} textAnchor="middle" fontSize={14} className="fill-muted-foreground" {...halo(14)}>
              {fmt(v)}
            </text>
          )}
        </g>
      ))}
      {visible
        .filter((e) => e.kind === "interval")
        .map((e) => {
          const { focused, dimmed, appeared } = emphasis(e.id, state);
          const from = e.from === null ? pad - 10 : X(e.from);
          const to = e.to === null ? W - pad + 10 : X(e.to);
          return (
            <line
              key={e.id}
              x1={from}
              x2={to}
              y1={lineY}
              y2={lineY}
              strokeWidth={focused ? 7 : 5}
              strokeLinecap="butt"
              {...drawn(appeared)}
              className={cn(focused ? "stroke-primary" : "stroke-primary/60", dimmed && "opacity-40", drawn(appeared).className)}
            />
          );
        })}
      {visible
        .filter((e) => e.kind === "span")
        .map((e) => {
          const { focused, dimmed, appeared } = emphasis(e.id, state);
          const a = X(e.from);
          const b = X(e.to);
          const tone = focused ? "stroke-primary" : "stroke-foreground";
          const marker = `url(#${arrowId}-${focused ? "look" : "ink"})`;
          return (
            <g key={e.id} className={cn(dimmed && "opacity-40", "transition-opacity duration-300")}>
              {/* Thin guides down to the numbers measured between, then the
                  dimension line itself with an arrow at each end. */}
              <line x1={a} x2={a} y1={spanY - 6} y2={lineY - 8} strokeWidth={1} strokeDasharray="2 3" className="stroke-foreground/35" />
              <line x1={b} x2={b} y1={spanY - 6} y2={lineY - 8} strokeWidth={1} strokeDasharray="2 3" className="stroke-foreground/35" />
              <line
                x1={a}
                x2={b}
                y1={spanY}
                y2={spanY}
                strokeWidth={focused ? 2.2 : 1.6}
                markerStart={marker}
                markerEnd={marker}
                className={cn(tone, appeared && "motion-safe:animate-wt-appear")}
              />
              {e.label && (
                <text
                  x={(a + b) / 2}
                  y={spanY - 7}
                  textAnchor="middle"
                  fontSize={15}
                  className={cn(focused ? "fill-primary font-semibold" : "fill-foreground", appeared && "motion-safe:animate-wt-appear")}
                  {...halo(15)}
                >
                  <SvgLabelText label={e.label} />
                </text>
              )}
            </g>
          );
        })}
      {visible.map((e) => {
        const { focused, dimmed, appeared } = emphasis(e.id, state);
        const pop = appeared ? "motion-safe:animate-wt-appear [transform-box:fill-box] origin-center" : undefined;
        const text = cn(focused ? "fill-primary font-semibold" : "fill-foreground", dimmed && "opacity-55");
        if (e.kind === "span") return null;
        if (e.kind === "interval") {
          return (
            <g key={`${e.id}-ends`}>
              {e.from !== null && (
                <circle cx={X(e.from)} cy={lineY} r={5.5} strokeWidth={2} className={cn("stroke-primary", e.openFrom ? "fill-background" : "fill-primary")} />
              )}
              {e.to !== null && (
                <circle cx={X(e.to)} cy={lineY} r={5.5} strokeWidth={2} className={cn("stroke-primary", e.openTo ? "fill-background" : "fill-primary")} />
              )}
            </g>
          );
        }
        if (e.kind === "point") {
          return (
            <g key={e.id} className={cn(dimmed && "opacity-55")}>
              <circle
                cx={X(e.at)}
                cy={lineY}
                r={focused ? 6.5 : 5.5}
                strokeWidth={2}
                className={cn(focused ? "stroke-primary" : "stroke-foreground", e.open ? "fill-background" : focused ? "fill-primary" : "fill-foreground", pop)}
              />
              {e.label && (
                <text x={X(e.at)} y={lineY - 15} textAnchor="middle" fontSize={16} className={text} {...halo(16)}>
                  <SvgLabelText label={e.label} />
                </text>
              )}
            </g>
          );
        }
        return (
          <text key={e.id} x={X(e.at)} y={lineY - 15} textAnchor="middle" fontSize={16} className={cn(text, pop)} {...halo(16)}>
            <SvgLabelText label={e.text} />
          </text>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

// Series colours skip the gold chart token: gold is the achievement accent,
// kept for score improvement, and a bar shouldn't read as a reward.
const SERIES = ["var(--chart-1)", "var(--chart-4)", "var(--chart-3)", "var(--chart-5)"];
const SHADES = {
  light: "color-mix(in oklch, var(--foreground) 18%, transparent)",
  mid: "color-mix(in oklch, var(--foreground) 45%, transparent)",
  dark: "var(--foreground)",
  brand: "var(--primary)",
};
const seriesFill = (series: { shade?: keyof typeof SHADES }, k: number) => (series.shade ? SHADES[series.shade] : SERIES[k % SERIES.length]);

export function BarsFigure({ panel, state }: { panel: BarsPanel; state: BarsState }) {
  // 360 wide, like the plane, so the text is about its stated size in a
  // half-width column and still about 12px on a phone.
  const W = 360;
  const padL = 40;
  const padR = 8;
  const padT = 22;
  // Category names tilt only when they wouldn't fit flat under their group.
  const long = panel.categories.some((c) => c.length * 7 > (W - 50) / panel.categories.length - 8);
  const padB = long ? 70 : 32;
  const plotH = 190;
  const H = plotH + padT + padB;
  const plotW = W - padL - padR;
  const max = Math.max(...panel.series.flatMap((s) => s.values), 0);
  const step = niceStep(panel.yMax ?? (max * 1.05 || 1), 5);
  const top = panel.yMax ?? Math.ceil((max * 1.02) / step) * step;
  const Y = (v: number) => padT + plotH - (v / (top || 1)) * plotH;
  const groupW = plotW / panel.categories.length;
  const barW = (groupW * 0.72) / panel.series.length;
  const isFocused = (s: number, c: number) =>
    state.focus.some((f) => (typeof f === "number" ? f === c : f[0] === s && f[1] === c));
  const categoryFocused = (c: number) => state.focus.some((f) => (typeof f === "number" ? f === c : f[1] === c));

  // Focus is an outline and the bar's value, never transparency: fading a bar
  // changes its colour, and the colour is what says which series it is.
  return (
    <figure className="mx-auto w-full max-w-[30rem]">
      {panel.title && <figcaption className="mb-1 text-center text-sm font-medium">{panel.title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={panel.title ?? "Bar chart"}>
        {ticks(0, top, step).map((v) => (
          <g key={v}>
            <line x1={padL} x2={padL + plotW} y1={Y(v)} y2={Y(v)} className="stroke-foreground/10" strokeWidth={1} />
            <text x={padL - 6} y={Y(v) + 4} textAnchor="end" fontSize={12} className="fill-muted-foreground">
              {fmt(v)}
            </text>
          </g>
        ))}
        <line x1={padL} x2={padL + plotW} y1={Y(0)} y2={Y(0)} className={INK} strokeWidth={1.4} />
        {panel.yLabel && (
          <text transform={`translate(11 ${padT + plotH / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} className="fill-muted-foreground">
            {panel.yLabel}
          </text>
        )}
        {panel.categories.map((cat, c) => {
          const gx = padL + c * groupW + groupW * 0.14;
          return (
            <g key={cat + c}>
              {panel.series.map((s, k) => {
                const v = s.values[c] ?? 0;
                const focused = isFocused(k, c);
                const x = gx + k * barW;
                return (
                  <g key={s.name}>
                    <rect
                      x={x}
                      y={Y(v)}
                      width={barW - 2}
                      height={Math.max(0, Y(0) - Y(v))}
                      style={{ fill: seriesFill(s, k) }}
                      strokeWidth={focused ? 3 : 0}
                      className="stroke-primary transition-[stroke-width] duration-300"
                    />
                    {focused && (
                      <text
                        x={x + (barW - 2) / 2}
                        y={Y(v) - 7}
                        textAnchor="middle"
                        fontSize={14}
                        className="fill-primary font-semibold motion-safe:animate-wt-appear [transform-box:fill-box] origin-bottom"
                        {...halo(14)}
                      >
                        {fmt(v)}
                      </text>
                    )}
                  </g>
                );
              })}
              <text
                x={padL + c * groupW + groupW / 2}
                y={Y(0) + 17}
                textAnchor={long ? "end" : "middle"}
                transform={long ? `rotate(-30 ${padL + c * groupW + groupW / 2} ${Y(0) + 17})` : undefined}
                fontSize={12.5}
                className={cn("fill-foreground", categoryFocused(c) && "font-semibold")}
              >
                {cat}
              </text>
            </g>
          );
        })}
      </svg>
      {panel.series.length > 1 && (
        <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {panel.series.map((s, k) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm" style={{ background: seriesFill(s, k) }} aria-hidden />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}
