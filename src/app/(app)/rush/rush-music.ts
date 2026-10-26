/**
 * The music under a rush (2026-10-25): an original, synthesized loop, the way
 * the sound effects are made — no audio files to license, host or download,
 * and nothing that starts until the first question is on screen.
 *
 * The brief was Kahoot's question music: catchy, quick, a little urgent,
 * never so loud it competes with thinking. So: eight bars of bright major
 * pop (I–V–vi–IV), four-on-the-floor kick, a chiptune lead, a bouncing bass,
 * and a mix that sits well under the answer sounds. In a question's last ten
 * seconds it speeds up and the hi-hats double, which is most of what makes a
 * countdown feel like one.
 *
 * The melody is written for PrepHub; it borrows nothing but the chord
 * progression every pop song shares.
 *
 * Built in two layers so it can be checked without a speaker: `scheduleSteps`
 * lays a span of notes onto any BaseAudioContext (an OfflineAudioContext
 * renders it for a level test), and `createRushMusic` is the real-time wrapper
 * that keeps a tenth of a second of notes queued ahead of the playhead.
 */

const STEPS_PER_BAR = 16;
const BARS = 8;
export const LOOP_STEPS = STEPS_PER_BAR * BARS;
export const TEMPO = 128;
export const INTENSE_TEMPO = 144;

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Bass root and the pad's triad, one chord per bar: C, G, Am, F, twice. */
const CHORDS: { root: number; triad: [number, number, number] }[] = [
  { root: 48, triad: [60, 64, 67] }, // C
  { root: 43, triad: [59, 62, 67] }, // G
  { root: 45, triad: [60, 64, 69] }, // Am
  { root: 41, triad: [60, 65, 69] }, // F
];

/** The lead, eight eighth notes a bar (null is a rest): a call, then an answer. */
const MELODY: (number | null)[][] = [
  [67, 72, 76, 79, 76, null, 72, null],
  [71, 74, 79, 74, 71, null, 67, null],
  [69, 72, 76, 81, 79, 76, 72, null],
  [65, 69, 72, 77, 76, 74, 72, 71],
  [72, null, 72, 74, 76, null, 79, null],
  [74, null, 74, 76, 74, null, 71, null],
  [72, null, 72, 74, 76, null, 81, null],
  [79, 77, 76, 74, 72, null, null, null],
];

/** Levels within the music bus, which itself sits under the effects. */
const MIX = { kick: 0.55, clap: 0.22, hat: 0.09, bass: 0.2, lead: 0.11, pad: 0.035 };

export function stepSeconds(intense: boolean): number {
  return 60 / (intense ? INTENSE_TEMPO : TEMPO) / 4;
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  freq: number,
  dur: number,
  type: OscillatorType,
  peak: number,
  cutoff?: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.006);
  gain.gain.exponentialRampToValueAtTime(peak * 0.6, at + dur * 0.4);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  if (cutoff) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    osc.connect(filter).connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function kick(ctx: BaseAudioContext, out: AudioNode, at: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, at);
  osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
  gain.gain.setValueAtTime(MIX.kick, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.18);
}

function noise(ctx: BaseAudioContext, out: AudioNode, at: number, dur: number, type: BiquadFilterType, freq: number, peak: number) {
  let buffer = noiseCache.get(ctx);
  if (!buffer) {
    buffer = noiseBuffer(ctx);
    noiseCache.set(ctx, buffer);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  source.connect(filter).connect(gain).connect(out);
  source.start(at, Math.random() * 0.5);
  source.stop(at + dur + 0.02);
}

/** Every note of one sixteenth-note step, at `at` seconds on `ctx`'s clock. */
export function playStep(ctx: BaseAudioContext, out: AudioNode, step: number, at: number, intense: boolean) {
  const bar = Math.floor(step / STEPS_PER_BAR) % BARS;
  const pos = step % STEPS_PER_BAR;
  const chord = CHORDS[bar % CHORDS.length];
  const sixteenth = stepSeconds(intense);

  if (pos % 4 === 0) kick(ctx, out, at);
  if (pos === 4 || pos === 12) noise(ctx, out, at, 0.14, "bandpass", 1600, MIX.clap);
  // Off-beat eighths normally; every sixteenth, accented on the off-beats, once time is short.
  if (intense ? true : pos % 4 === 2) noise(ctx, out, at, 0.04, "highpass", 7000, pos % 4 === 2 ? MIX.hat : MIX.hat * 0.6);

  if (pos % 2 === 0) {
    // The bass bounces between the root and its octave on every eighth.
    const bassNote = chord.root + (pos % 4 === 2 ? 12 : 0);
    tone(ctx, out, at, midi(bassNote), sixteenth * 1.8, "triangle", MIX.bass);
    const lead = MELODY[bar][pos / 2];
    if (lead !== null) tone(ctx, out, at, midi(lead), sixteenth * 1.7, "square", MIX.lead, 2600);
  }

  if (pos === 0) {
    for (const note of chord.triad) tone(ctx, out, at, midi(note), sixteenth * STEPS_PER_BAR * 0.95, "triangle", MIX.pad);
  }
}

/** Lays `count` steps from `fromStep` starting at `startTime`; returns when the next step falls. */
export function scheduleSteps(
  ctx: BaseAudioContext,
  out: AudioNode,
  fromStep: number,
  count: number,
  startTime: number,
  intense: boolean,
): number {
  let at = startTime;
  for (let i = 0; i < count; i++) {
    playStep(ctx, out, (fromStep + i) % LOOP_STEPS, at, intense);
    at += stepSeconds(intense);
  }
  return at;
}

export type RushMusic = { start: () => void; stop: () => void; setIntense: (on: boolean) => void };

/** The music bus's level against the effects (which play at full level into the same limiter). */
export const MUSIC_LEVEL = 0.3;

export function createRushMusic(ctx: AudioContext, destination: AudioNode): RushMusic {
  const bus = ctx.createGain();
  bus.gain.value = 0.0001;
  bus.connect(destination);

  let timer: ReturnType<typeof setInterval> | null = null;
  let step = 0;
  let nextTime = 0;
  let intense = false;

  // Keep a tenth of a second queued, topped up every 25ms: notes land on the
  // audio clock, so a busy main thread delays nothing audible.
  const tick = () => {
    while (nextTime < ctx.currentTime + 0.1) {
      playStep(ctx, bus, step, nextTime, intense);
      nextTime += stepSeconds(intense);
      step = (step + 1) % LOOP_STEPS;
    }
  };

  return {
    start() {
      if (timer) return;
      step = 0;
      nextTime = ctx.currentTime + 0.05;
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setValueAtTime(0.0001, ctx.currentTime);
      bus.gain.exponentialRampToValueAtTime(MUSIC_LEVEL, ctx.currentTime + 0.8);
      tick();
      timer = setInterval(tick, 25);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), ctx.currentTime);
      bus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    },
    setIntense(on: boolean) {
      intense = on;
    },
  };
}
