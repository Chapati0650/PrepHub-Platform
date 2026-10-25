"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A short burst of confetti. A canvas, so a hundred and forty pieces cost one
 * element rather than a hundred and forty; brand colours only. Does nothing at
 * all under reduced motion, and removes itself when it lands.
 *
 * Shared by a 1v1 Rush win and the moment a school's Premium switches on.
 * `originY` is where the burst starts, as a fraction of the viewport height,
 * so it can come from whatever the screen is celebrating.
 */
export function Confetti({ originY = 0.35, delayMs = 0 }: { originY?: number; delayMs?: number }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const t = window.setTimeout(() => setFinished(true), 0);
      return () => window.clearTimeout(t);
    }
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    el.width = window.innerWidth * dpr;
    el.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);

    const styles = getComputedStyle(document.documentElement);
    const colors = ["--primary", "--achievement", "--marker"].map((v) => styles.getPropertyValue(v).trim() || "#0f766e");
    const pieces = Array.from({ length: 140 }, () => ({
      x: window.innerWidth * (0.2 + Math.random() * 0.6),
      y: window.innerHeight * originY,
      vx: (Math.random() - 0.5) * 9,
      vy: -6 - Math.random() * 8,
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    let startedAt: number | null = null;
    let frame = 0;
    const tick = (time: number) => {
      startedAt ??= time;
      const elapsed = time - startedAt;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of pieces) {
        p.vy += 0.28;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - elapsed / 2600);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (elapsed < 2600) frame = requestAnimationFrame(tick);
      else setFinished(true);
    };
    const start = window.setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      window.clearTimeout(start);
      cancelAnimationFrame(frame);
    };
  }, [originY, delayMs]);

  if (finished) return null;
  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-[60] size-full" />;
}
