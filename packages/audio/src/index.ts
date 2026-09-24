// Central audio + haptics (§28–29). Games call `audio.play(...)` and
// `audio.buzz(...)`; nobody else touches AudioContext or navigator.vibrate.
//
// Physical things (cards, chips) are recordings; UI cues (your turn, nudge,
// reject) are synthesised with WebAudio. Recordings load after the first tap
// and, until they have (or if they can't), the synth stands in for them.

export type SoundId = "card-place" | "deal" | "shuffle" | "your-turn" | "pass" | "win" | "game-over" | "reject" | "nudge";

export interface FeedbackSettings {
  sound: boolean;
  /** 0–1 */
  volume: number;
  haptics: boolean;
}

const STORAGE_KEY = "pg:feedback";
const DEFAULTS: FeedbackSettings = { sound: true, volume: 0.7, haptics: true };

function load(): FeedbackSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<FeedbackSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

// ---------------------------------------------------------------------------
// Synth voices
// ---------------------------------------------------------------------------

type Voice = (ctx: AudioContext, out: AudioNode, t: number) => void;

function tone(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  { freq, to, type = "sine", dur, gain = 0.25, attack = 0.005 }: { freq: number; to?: number; type?: OscillatorType; dur: number; gain?: number; attack?: number },
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(ctx: AudioContext, out: AudioNode, t: number, { dur, gain = 0.3, freq = 2400 }: { dur: number; gain?: number; freq?: number }) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(out);
  src.start(t);
}

const VOICES: Record<SoundId, Voice> = {
  // A card slapped onto felt: papery snap plus a soft thump.
  "card-place": (c, o, t) => {
    noise(c, o, t, { dur: 0.07, gain: 0.5, freq: 3200 });
    tone(c, o, t, { freq: 170, to: 80, dur: 0.09, gain: 0.35 });
  },
  deal: (c, o, t) => noise(c, o, t, { dur: 0.035, gain: 0.25, freq: 4200 }),
  shuffle: (c, o, t) => {
    for (let i = 0; i < 6; i++) noise(c, o, t + i * 0.05, { dur: 0.04, gain: 0.2, freq: 3800 });
  },
  "your-turn": (c, o, t) => {
    tone(c, o, t, { freq: 659, dur: 0.14, type: "triangle", gain: 0.22 });
    tone(c, o, t + 0.11, { freq: 988, dur: 0.22, type: "triangle", gain: 0.2 });
  },
  pass: (c, o, t) => tone(c, o, t, { freq: 330, to: 220, dur: 0.16, type: "triangle", gain: 0.14 }),
  reject: (c, o, t) => {
    tone(c, o, t, { freq: 150, dur: 0.07, type: "square", gain: 0.08 });
    tone(c, o, t + 0.09, { freq: 130, dur: 0.09, type: "square", gain: 0.08 });
  },
  nudge: (c, o, t) => {
    tone(c, o, t, { freq: 880, dur: 0.08, gain: 0.2 });
    tone(c, o, t + 0.12, { freq: 880, dur: 0.1, gain: 0.2 });
  },
  win: (c, o, t) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(c, o, t + i * 0.09, { freq: f, dur: 0.28, type: "triangle", gain: 0.2 }));
    tone(c, o, t + 0.36, { freq: 1568, dur: 0.5, gain: 0.08 });
  },
  "game-over": (c, o, t) => {
    tone(c, o, t, { freq: 392, dur: 0.2, type: "triangle", gain: 0.16 });
    tone(c, o, t + 0.16, { freq: 330, dur: 0.32, type: "triangle", gain: 0.14 });
  },
};

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

/**
 * `start` skips each file's lead-in silence (measured with ffmpeg's
 * silencedetect), so the sound lands with the animation instead of after it.
 * `new URL(…, import.meta.url)` lets Vite fingerprint and ship the files.
 */
const SAMPLES = {
  "card-place": { url: new URL("./sounds/card-place.mp3", import.meta.url).href, start: 0.045 },
  "card-take-1": { url: new URL("./sounds/card-take-1.mp3", import.meta.url).href, start: 0.15 },
  "card-take-2": { url: new URL("./sounds/card-take-2.mp3", import.meta.url).href, start: 0.19 },
  "card-take-3": { url: new URL("./sounds/card-take-3.mp3", import.meta.url).href, start: 0.02 },
  shuffle: { url: new URL("./sounds/shuffle.mp3", import.meta.url).href, start: 0.02 },
  "chips-rake": { url: new URL("./sounds/chips-rake.mp3", import.meta.url).href, start: 0.13 },
  "chips-place": { url: new URL("./sounds/chips-place.mp3", import.meta.url).href, start: 0.035 },
} as const;

type SampleId = keyof typeof SAMPLES;

/**
 * Which recording(s) a sound uses. Several ids = pick one at random, so a run
 * of draws doesn't sound like a loop. `layer` keeps the synth playing too.
 */
const RECORDED: Partial<Record<SoundId, { ids: SampleId[]; gain?: number; layer?: boolean }>> = {
  "card-place": { ids: ["card-place"] },
  deal: { ids: ["card-take-1", "card-take-2", "card-take-3"], gain: 0.8 },
  shuffle: { ids: ["shuffle"] },
  // The winner rakes in the pot; everyone else pays up.
  win: { ids: ["chips-rake"], gain: 0.9, layer: true },
  "game-over": { ids: ["chips-place"], gain: 0.8, layer: true },
};

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

class Feedback {
  settings: FeedbackSettings = typeof localStorage === "undefined" ? { ...DEFAULTS } : load();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<SampleId, AudioBuffer>();

  /**
   * Browsers keep audio locked until a user gesture (§28). Called on the first
   * tap/key anywhere; safe to call again.
   */
  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
      void this.loadSamples(this.ctx);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** ~120 KB all in; each one is optional, since the synth covers for it. */
  private async loadSamples(ctx: AudioContext) {
    await Promise.all(
      (Object.keys(SAMPLES) as SampleId[]).map(async (id) => {
        try {
          const res = await fetch(SAMPLES[id].url);
          if (res.ok) this.buffers.set(id, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          // Offline, blocked, or a codec the browser won't decode: synth it is.
        }
      }),
    );
  }

  play(sound: SoundId): void {
    if (!this.settings.sound || !this.ctx || !this.master || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime + 0.005;
    const rec = RECORDED[sound];
    const loaded = rec?.ids.filter((id) => this.buffers.has(id)) ?? [];
    if (!rec || !loaded.length || rec.layer) VOICES[sound](this.ctx, this.master, t);
    if (!rec || !loaded.length) return;

    const id = loaded[Math.floor(Math.random() * loaded.length)]!;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(id)!;
    // A hair of pitch wobble, so repeats don't sound copy-pasted.
    src.playbackRate.value = 0.96 + Math.random() * 0.08;
    const g = this.ctx.createGain();
    g.gain.value = rec.gain ?? 1;
    src.connect(g).connect(this.master);
    src.start(t, SAMPLES[id].start);
  }

  /** Optional haptics (§29). Silently nothing where unsupported (iOS Safari). */
  buzz(pattern: number | number[]): void {
    if (!this.settings.haptics) return;
    navigator.vibrate?.(pattern);
  }

  get canVibrate(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }

  update(patch: Partial<FeedbackSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.applyVolume();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Private mode: settings last for this visit only.
    }
  }

  private applyVolume() {
    if (this.master) this.master.gain.value = this.settings.volume * 0.9;
  }
}

export const audio = new Feedback();

if (typeof window !== "undefined") {
  const unlock = () => audio.unlock();
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}
