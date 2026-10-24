"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Flame, Volume2, VolumeX } from "lucide-react";

/**
 * The game feel shared by the recorded runner and the live room
 * (2026-10-24): sound, the streak flame, the points pop, the 3-2-1 countdown
 * and the win confetti.
 *
 * Everything here is presentation. Points, streaks and outcomes are decided
 * on the server (src/lib/rush/scoring.ts); these components only make what
 * already happened visible and audible. Motion is behind `motion-safe:`
 * throughout, and the confetti doesn't run at all under reduced motion, so a
 * student who has asked their device to keep still gets the same information
 * without any of it moving.
 */

// ---- Sound ------------------------------------------------------------------

/**
 * Synthesized rather than recorded: no audio files to license, host or
 * preload, and every effect is a few oscillator notes that start instantly.
 *
 * On by default — a game with no sound feels unfinished — with the toggle in
 * the corner of every Rush screen, remembered per device. A classroom
 * Chromebook is the obvious case for turning it off, and the toggle is where a
 * student will look for it.
 */
export type RushSound = "correct" | "wrong" | "streak" | "tick" | "count" | "go" | "win" | "lose";

const SOUND_KEY = "prephub-rush-sound";
const SOUND_EVENT = "prephub-rush-sound-change";

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "off";
  } catch {
    // Private windows and blocked storage: fall back to sound on.
    return false;
  }
}

function subscribeMuted(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(SOUND_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SOUND_EVENT, callback);
  };
}

/** One note: frequency, start offset and length in seconds, and a waveform. */
type Note = { f: number; at: number; dur: number; type?: OscillatorType; gain?: number; to?: number };

const PATTERNS: Record<RushSound, Note[]> = {
  correct: [
    { f: 784, at: 0, dur: 0.09 },
    { f: 1175, at: 0.08, dur: 0.14 },
  ],
  wrong: [{ f: 220, at: 0, dur: 0.24, type: "triangle", gain: 0.16, to: 150 }],
  streak: [
    { f: 880, at: 0, dur: 0.07 },
    { f: 1109, at: 0.06, dur: 0.07 },
    { f: 1319, at: 0.12, dur: 0.16 },
  ],
  tick: [{ f: 1400, at: 0, dur: 0.035, type: "square", gain: 0.05 }],
  count: [{ f: 660, at: 0, dur: 0.12 }],
  go: [{ f: 523, at: 0, dur: 0.22, to: 1047 }],
  win: [
    { f: 523, at: 0, dur: 0.12 },
    { f: 659, at: 0.11, dur: 0.12 },
    { f: 784, at: 0.22, dur: 0.12 },
    { f: 1047, at: 0.33, dur: 0.32 },
  ],
  lose: [
    { f: 392, at: 0, dur: 0.16, type: "triangle", gain: 0.14 },
    { f: 330, at: 0.15, dur: 0.16, type: "triangle", gain: 0.14 },
    { f: 262, at: 0.3, dur: 0.3, type: "triangle", gain: 0.14 },
  ],
};

export function useRushSound(): { play: (sound: RushSound) => void; muted: boolean; toggle: () => void } {
  // useSyncExternalStore rather than reading localStorage in a useState
  // initializer: the server always renders "sound on", and a stored "off"
  // must not make the first client render disagree with it (CLAUDE.md's
  // next-themes gotcha is the same shape of problem).
  const muted = useSyncExternalStore(subscribeMuted, readMuted, () => false);
  const context = useRef<AudioContext | null>(null);

  // Browsers only let audio start after a user gesture. Creating the context
  // lazily on the first play — which always follows a click or a key press —
  // and resuming it on any later gesture keeps the first sound from being
  // swallowed.
  useEffect(() => {
    const wake = () => void context.current?.resume();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  const play = useCallback(
    (sound: RushSound) => {
      if (muted || typeof window === "undefined") return;
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        context.current ??= new Ctx();
        const ctx = context.current;
        if (ctx.state === "suspended") void ctx.resume();
        const start = ctx.currentTime + 0.01;
        for (const note of PATTERNS[sound]) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = note.type ?? "sine";
          osc.frequency.setValueAtTime(note.f, start + note.at);
          if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to, start + note.at + note.dur);
          // A fast attack and an exponential release, so notes don't click.
          const peak = note.gain ?? 0.12;
          gain.gain.setValueAtTime(0.0001, start + note.at);
          gain.gain.exponentialRampToValueAtTime(peak, start + note.at + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(start + note.at);
          osc.stop(start + note.at + note.dur + 0.02);
        }
      } catch {
        // Audio is a garnish. A device that can't make a sound plays silently.
      }
    },
    [muted],
  );

  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(SOUND_KEY, readMuted() ? "on" : "off");
    } catch {
      // Storage unavailable: the toggle simply won't persist.
    }
    window.dispatchEvent(new Event(SOUND_EVENT));
  }, []);

  return { play, muted, toggle };
}

export function SoundToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!muted}
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
      className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
    </button>
  );
}

// ---- Streak -------------------------------------------------------------------

/**
 * The flame. Gold, because `achievement` is the token reserved for exactly
 * this kind of moment (CLAUDE.md), and a lucide glyph rather than an emoji so
 * it sits in the brand instead of on top of it. Shown from two in a row — one
 * correct answer isn't a streak — and keyed on the count so it bumps each time
 * it grows.
 */
export function StreakFlame({ streak }: { streak: number }) {
  if (streak < 2) return null;
  return (
    <span
      key={streak}
      className="inline-flex items-center gap-1 rounded-full bg-achievement/15 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-achievement-foreground motion-safe:animate-rush-bump dark:text-achievement"
      aria-label={`${streak} correct in a row`}
    >
      <Flame className="size-4 fill-current" aria-hidden />
      {streak}
    </span>
  );
}

// ---- Points pop ----------------------------------------------------------------

export type PointsBreakdown = { points: number; base: number; speed: number; streakBonus: number };

/**
 * The "+187" that floats up after an answer, with where it came from
 * underneath. Re-keyed by the caller on every answer so the animation replays.
 * Zero points shows nothing: a miss already reads as a miss.
 */
export function PointsPop({ result }: { result: PointsBreakdown | null }) {
  if (!result || result.points <= 0) return null;
  return (
    <div
      aria-hidden
      // Above the card, over the time bar — which is frozen while feedback
      // shows — so it never sits on top of the question being reviewed.
      className="pointer-events-none absolute -top-14 right-0 z-10 flex flex-col items-end motion-safe:animate-rush-pop"
    >
      <span className="font-heading text-3xl font-bold tabular-nums text-green-700 dark:text-green-400">
        +{result.points}
      </span>
      {result.base > 0 && (
        <span className="text-xs tabular-nums text-muted-foreground">
          {result.base} correct · +{result.speed} speed
          {result.streakBonus > 0 && (
            <span className="font-semibold text-achievement-foreground dark:text-achievement"> · +{result.streakBonus} streak</span>
          )}
        </span>
      )}
    </div>
  );
}

// ---- Countdown -----------------------------------------------------------------

/**
 * 3, 2, 1, GO before the first question of a recorded run. The live room has
 * its own five-second countdown on the shared clock; this is the same moment
 * for a run with no opponent present, and the clock doesn't start until it's
 * over — `onDone` is what serves the first question.
 */
export function GoCountdown({ onDone, play }: { onDone: () => void; play: (s: RushSound) => void }) {
  const [step, setStep] = useState(3);
  const done = useRef(onDone);
  const sound = useRef(play);
  useEffect(() => {
    done.current = onDone;
    sound.current = play;
  });

  useEffect(() => {
    sound.current("count");
    const timers = [
      window.setTimeout(() => {
        setStep(2);
        sound.current("count");
      }, 700),
      window.setTimeout(() => {
        setStep(1);
        sound.current("count");
      }, 1400),
      window.setTimeout(() => {
        setStep(0);
        sound.current("go");
      }, 2100),
      window.setTimeout(() => done.current(), 2650),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2" aria-live="assertive">
      <p
        key={step}
        className="font-heading text-hero-lg font-bold tracking-tight tabular-nums text-primary motion-safe:animate-rush-go"
      >
        {step === 0 ? "GO!" : step}
      </p>
      <p className="text-sm text-muted-foreground">{step === 0 ? "Clock's running." : "Get ready…"}</p>
    </div>
  );
}

// ---- Confetti --------------------------------------------------------------------

/**
 * A short burst for a win. A canvas, so a hundred and forty pieces cost one
 * element rather than a hundred and forty; brand colours only. Does nothing at
 * all under reduced motion, and removes itself when it lands.
 */
export function Confetti() {
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
      y: window.innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 9,
      vy: -6 - Math.random() * 8,
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    const startedAt = performance.now();
    let frame = 0;
    const tick = (time: number) => {
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
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  if (finished) return null;
  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-50 size-full" />;
}
