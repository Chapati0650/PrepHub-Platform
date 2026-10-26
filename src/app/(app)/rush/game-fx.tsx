"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Flame, Music, Volume2, VolumeX } from "lucide-react";
import { createRushMusic, type RushMusic } from "./rush-music";

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
const MUSIC_KEY = "prephub-rush-music";
const SOUND_EVENT = "prephub-rush-sound-change";

function readOff(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "off";
  } catch {
    // Private windows and blocked storage: fall back to on.
    return false;
  }
}

const readMuted = () => readOff(SOUND_KEY);
const readMusicOff = () => readOff(MUSIC_KEY);

/**
 * One AudioContext for every Rush screen, made on first use (always after a
 * click or key press, which browsers require) and kept across client-side
 * navigation. Everything Rush plays goes through one gentle limiter: effects
 * are loud enough to hear on a Chromebook speaker (2026-10-25: they were too
 * quiet), and no combination of them can spike into anything startling.
 */
let shared: { ctx: AudioContext; out: AudioNode } | null = null;

function audio(): { ctx: AudioContext; out: AudioNode } | null {
  if (shared) return shared;
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  limiter.connect(master).connect(ctx.destination);
  shared = { ctx, out: limiter };
  return shared;
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
    { f: 784, at: 0, dur: 0.1 },
    { f: 1175, at: 0.08, dur: 0.18 },
  ],
  // Two falling notes ("uh-oh") rather than one low sweep: a 220Hz tone all
  // but vanishes on a laptop speaker, and the limiter flattened the sweep.
  wrong: [
    { f: 330, at: 0, dur: 0.14, gain: 0.4 },
    { f: 247, at: 0.13, dur: 0.24, gain: 0.4, to: 220 },
  ],
  streak: [
    { f: 880, at: 0, dur: 0.08 },
    { f: 1109, at: 0.06, dur: 0.08 },
    { f: 1319, at: 0.12, dur: 0.2 },
  ],
  tick: [{ f: 1400, at: 0, dur: 0.04, type: "square", gain: 0.12 }],
  count: [{ f: 660, at: 0, dur: 0.14 }],
  go: [{ f: 523, at: 0, dur: 0.26, to: 1047 }],
  win: [
    { f: 523, at: 0, dur: 0.12 },
    { f: 659, at: 0.11, dur: 0.12 },
    { f: 784, at: 0.22, dur: 0.12 },
    { f: 1047, at: 0.33, dur: 0.4 },
  ],
  lose: [
    { f: 392, at: 0, dur: 0.16, gain: 0.34 },
    { f: 330, at: 0.15, dur: 0.16, gain: 0.34 },
    { f: 262, at: 0.3, dur: 0.32, gain: 0.34 },
  ],
};

export type RushSoundControls = {
  play: (sound: RushSound) => void;
  /** All Rush sound, effects and music. */
  muted: boolean;
  toggle: () => void;
  /** Just the music; effects stay on. */
  musicOff: boolean;
  toggleMusic: () => void;
};

export function useRushSound(): RushSoundControls {
  // useSyncExternalStore rather than reading localStorage in a useState
  // initializer: the server always renders "sound on", and a stored "off"
  // must not make the first client render disagree with it (CLAUDE.md's
  // next-themes gotcha is the same shape of problem).
  const muted = useSyncExternalStore(subscribeMuted, readMuted, () => false);
  const musicOff = useSyncExternalStore(subscribeMuted, readMusicOff, () => false);

  // Browsers only let audio start after a user gesture. Creating the context
  // lazily on the first play — which always follows a click or a key press —
  // and resuming it on any later gesture keeps the first sound from being
  // swallowed.
  useEffect(() => {
    const wake = () => void shared?.ctx.resume();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  const play = useCallback(
    (sound: RushSound) => {
      if (muted) return;
      try {
        const engine = audio();
        if (!engine) return;
        const { ctx, out } = engine;
        if (ctx.state === "suspended") void ctx.resume();
        const start = ctx.currentTime + 0.01;
        for (const note of PATTERNS[sound]) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = note.type ?? "triangle";
          osc.frequency.setValueAtTime(note.f, start + note.at);
          if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to, start + note.at + note.dur);
          // A fast attack and an exponential release, so notes don't click.
          const peak = note.gain ?? 0.38;
          gain.gain.setValueAtTime(0.0001, start + note.at);
          gain.gain.exponentialRampToValueAtTime(peak, start + note.at + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.dur);
          osc.connect(gain).connect(out);
          osc.start(start + note.at);
          osc.stop(start + note.at + note.dur + 0.02);
        }
      } catch {
        // Audio is a garnish. A device that can't make a sound plays silently.
      }
    },
    [muted],
  );

  const toggle = useCallback(() => flip(SOUND_KEY), []);
  const toggleMusic = useCallback(() => flip(MUSIC_KEY), []);

  return { play, muted, toggle, musicOff, toggleMusic };
}

function flip(key: string) {
  try {
    window.localStorage.setItem(key, readOff(key) ? "on" : "off");
  } catch {
    // Storage unavailable: the toggle simply won't persist.
  }
  window.dispatchEvent(new Event(SOUND_EVENT));
}

/**
 * Plays the round music (./rush-music.ts) while `active` — only while
 * questions are being played, never in a lobby or on results — and speeds it
 * up while `intense`. Stops with a short fade when the round ends, when the
 * student turns music or sound off, or when the screen goes away.
 */
export function useRushMusic(controls: RushSoundControls, active: boolean, intense: boolean) {
  const music = useRef<RushMusic | null>(null);
  const on = active && !controls.muted && !controls.musicOff;

  useEffect(() => {
    if (!on) return;
    const sound = audio();
    if (!sound) return;
    if (sound.ctx.state === "suspended") void sound.ctx.resume();
    music.current ??= createRushMusic(sound.ctx, sound.out);
    const player = music.current;
    player.start();
    return () => player.stop();
  }, [on]);

  useEffect(() => {
    music.current?.setIntense(intense);
  }, [intense]);
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

/**
 * Sound and music, side by side in the corner of every Rush screen. Music
 * has its own switch, labelled in words, so a student who finds it
 * distracting can turn it off and keep the answer sounds.
 */
export function SoundControls({ controls }: { controls: RushSoundControls }) {
  return (
    <span className="flex items-center gap-1">
      {!controls.muted && (
        <button
          type="button"
          onClick={controls.toggleMusic}
          aria-pressed={!controls.musicOff}
          className={`flex h-8 items-center gap-1.5 rounded-full px-2.5 text-sm transition-colors hover:bg-muted ${
            controls.musicOff ? "text-muted-foreground line-through decoration-1" : "text-foreground"
          }`}
        >
          <Music className="size-4" aria-hidden />
          Music
        </button>
      )}
      <SoundToggle muted={controls.muted} onToggle={controls.toggle} />
    </span>
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

// Lives in src/components now: the school-access moment uses the same burst.
export { Confetti } from "@/components/confetti";
