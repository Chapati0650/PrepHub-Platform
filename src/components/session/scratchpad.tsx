"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, GripHorizontal, PenLine, Trash2, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { readWork, sweepOldWork, writeWork } from "./local-store";

/**
 * A whiteboard for working a problem out on screen (2026-10-24) — the scrap
 * paper a student would have beside a real test. A floating panel over the
 * question, draggable by its bar and resizable from its corner, so it can sit
 * beside a geometry figure or under a long equation. Each question has its
 * own page: moving to the next question shows that question's working, and
 * coming back shows this one again.
 *
 * Strokes are kept as points in CSS pixels, not pixels on a bitmap, so the
 * board redraws crisply at any size or zoom and survives a theme change —
 * ink is stored by name and resolved to a colour that shows on the current
 * background. The eraser removes ink (destination-out), so it never paints
 * over the grid.
 */

type InkName = "ink" | "blue" | "red";
type Stroke = { tool: "pen" | "eraser"; ink: InkName; width: number; points: number[] };
type Saved = { strokes: Stroke[] };
type HistoryEntry = { kind: "stroke" } | { kind: "clear"; strokes: Stroke[] };

const INKS: { name: InkName; label: string; light: string; dark: string }[] = [
  { name: "ink", label: "Black", light: "#18181b", dark: "#f4f4f5" },
  { name: "blue", label: "Blue", light: "#1d4ed8", dark: "#93c5fd" },
  { name: "red", label: "Red", light: "#dc2626", dark: "#fca5a5" },
];
const PEN_WIDTH = 2.5;
const ERASER_WIDTH = 22;

function inkColor(name: InkName): string {
  const dark = document.documentElement.classList.contains("dark");
  const ink = INKS.find((i) => i.name === name) ?? INKS[0];
  return dark ? ink.dark : ink.light;
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const p = stroke.points;
  if (p.length < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = stroke.tool === "eraser" ? "#000" : inkColor(stroke.ink);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (p.length === 2) {
    // A tap is a dot.
    ctx.beginPath();
    ctx.arc(p[0], p[1], stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Midpoint quadratic smoothing: each recorded point becomes a control
    // point, which is what keeps handwriting from looking like a polygon.
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = (p[i] + p[i + 2]) / 2;
      const my = (p[i + 1] + p[i + 3]) / 2;
      ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
    }
    ctx.lineTo(p[p.length - 2], p[p.length - 1]);
    ctx.stroke();
  }
  ctx.restore();
}

export function Scratchpad({ storageKey, onClose }: { storageKey: string; onClose: () => void }) {
  // The parent keys this component by question, so it remounts per question
  // and the saved page is read once, lazily — never during server rendering,
  // because the board only exists after a click.
  const [initial] = useState<Stroke[]>(() => readWork<Saved>(`scratch:${storageKey}`)?.strokes ?? []);
  const strokes = useRef<Stroke[]>(initial);
  const history = useRef<HistoryEntry[]>(initial.map(() => ({ kind: "stroke" as const })));
  const current = useRef<Stroke | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [ink, setInk] = useState<InkName>("ink");
  const [canUndo, setCanUndo] = useState(initial.length > 0);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);

  function redraw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    for (const s of strokes.current) drawStroke(ctx, s);
  }

  function save() {
    writeWork<Saved>(`scratch:${storageKey}`, { strokes: strokes.current });
  }

  // Size the bitmap to the box (and the screen's pixel density) whenever the
  // box changes size, then redraw from the stored strokes. Also redraws when
  // the theme flips, so black ink becomes white ink on a dark board.
  useEffect(() => {
    sweepOldWork();
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = box.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      redraw();
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(box);
    const theme = new MutationObserver(redraw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
    // redraw reads refs only, so running this once per mount is the intent.
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function pointAt(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [Math.round((e.clientX - rect.left) * 10) / 10, Math.round((e.clientY - rect.top) * 10) / 10];
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = pointAt(e);
    const eraser = tool === "eraser" || e.button === 5; // a stylus's eraser end
    current.current = { tool: eraser ? "eraser" : "pen", ink, width: eraser ? ERASER_WIDTH : PEN_WIDTH, points: [x, y] };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = current.current;
    const ctx = canvasRef.current?.getContext("2d");
    if (!stroke || !ctx) return;
    const [x, y] = pointAt(e);
    const n = stroke.points.length;
    // Skip sub-pixel jitter: it adds points without adding shape.
    if (Math.abs(stroke.points[n - 2] - x) < 0.8 && Math.abs(stroke.points[n - 1] - y) < 0.8) return;
    stroke.points.push(x, y);
    // Draw just the newest segment while the pen is down; the smoothed
    // version replaces it on the redraw when the stroke ends.
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStroke(ctx, { ...stroke, points: stroke.points.slice(-4) });
  }

  function onPointerUp() {
    const stroke = current.current;
    current.current = null;
    if (!stroke) return;
    strokes.current.push(stroke);
    history.current.push({ kind: "stroke" });
    redraw();
    save();
    setCanUndo(true);
  }

  function undo() {
    const last = history.current.pop();
    if (!last) return;
    if (last.kind === "clear") strokes.current = last.strokes;
    else strokes.current.pop();
    redraw();
    save();
    setCanUndo(history.current.length > 0);
  }

  function clear() {
    if (strokes.current.length === 0) return;
    history.current.push({ kind: "clear", strokes: strokes.current });
    strokes.current = [];
    redraw();
    save();
    setCanUndo(true);
  }

  // Drag by the bar. The panel is fixed-position; the offset is from where
  // it first appeared, so it never needs to know the viewport's size.
  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (window.matchMedia("(max-width: 639px)").matches) return; // a bottom sheet on phones
    const start = { x: e.clientX, y: e.clientY };
    const from = offset ?? { x: 0, y: 0 };
    const move = (ev: PointerEvent) => setOffset({ x: from.x + ev.clientX - start.x, y: from.y + ev.clientY - start.y });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Scratch work"
      style={offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
      className="fixed inset-x-0 bottom-0 z-40 flex h-[55vh] flex-col overflow-hidden border-t border-border bg-card shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-24 sm:h-[26rem] sm:w-[34rem] sm:min-w-72 sm:resize sm:rounded-2xl sm:border"
    >
      <div
        onPointerDown={startDrag}
        className="flex shrink-0 cursor-default items-center justify-between gap-2 border-b border-border px-3 py-2 select-none sm:cursor-grab sm:active:cursor-grabbing"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <GripHorizontal className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
          Scratch work
        </span>
        <span className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <ToolButton label="Pen" pressed={tool === "pen"} onClick={() => setTool("pen")}>
            <PenLine className="size-4" aria-hidden />
          </ToolButton>
          {tool === "pen" &&
            INKS.map((i) => (
              <button
                key={i.name}
                type="button"
                aria-label={`${i.label} ink`}
                aria-pressed={ink === i.name}
                onClick={() => setInk(i.name)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-full",
                  ink === i.name ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : "hover:bg-muted",
                )}
              >
                <span
                  className="size-3.5 rounded-full border border-foreground/20"
                  style={{ backgroundColor: i.name === "ink" ? "var(--foreground)" : i.light }}
                />
              </button>
            ))}
          <ToolButton label="Eraser" pressed={tool === "eraser"} onClick={() => setTool("eraser")}>
            <Eraser className="size-4" aria-hidden />
          </ToolButton>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <ToolButton label="Undo" onClick={undo} disabled={!canUndo}>
            <Undo2 className="size-4" aria-hidden />
          </ToolButton>
          <ToolButton label="Clear the page" onClick={clear}>
            <Trash2 className="size-4" aria-hidden />
          </ToolButton>
          <ToolButton label="Close scratch work" onClick={onClose}>
            <X className="size-4" aria-hidden />
          </ToolButton>
        </span>
      </div>
      <div
        ref={boxRef}
        className="relative min-h-0 flex-1"
        // Dot grid, drawn by CSS rather than on the canvas so the eraser
        // can't rub it out and it costs nothing to redraw.
        style={{
          backgroundImage: "radial-gradient(circle, color-mix(in oklch, var(--foreground) 16%, transparent) 1px, transparent 1.2px)",
          backgroundSize: "22px 22px",
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="Drawing area"
          className={cn("absolute inset-0 touch-none", tool === "eraser" ? "cursor-cell" : "cursor-crosshair")}
        />
      </div>
    </div>
  );
}

function ToolButton({
  label,
  pressed,
  onClick,
  disabled,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40",
        pressed && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}
