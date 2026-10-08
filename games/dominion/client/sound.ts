// Dominion's sounds (§15). Gameplay asks for stable `sfx.*` / `music.*` IDs;
// a recording from the art track's manifest plays if there is one, otherwise a
// short synthesised stand-in. The shell owns on/off and volume, and nothing
// plays before the first tap or key press (the browser wouldn't let it anyway).
//
// Sounds follow only events this player received, which are already redacted
// to what they could see: a sound never hints at anything in the fog.

import { audio } from "@games/audio";
import manifestJson from "./assets/manifest.json";
import type { AssetManifest } from "./assets.ts";

export type Sfx =
  | "sfx.ui.select" | "sfx.ui.confirm"
  | "sfx.turn.warning"
  | "sfx.unit.move" | "sfx.unit.move.mounted" | "sfx.unit.move.water"
  | "sfx.combat.melee" | "sfx.combat.ranged" | "sfx.combat.siege" | "sfx.combat.naval" | "sfx.unit.defeat"
  | "sfx.unit.heal" | "sfx.unit.promote" | "sfx.unit.embark" | "sfx.unit.disembark" | "sfx.unit.upgrade"
  | "sfx.city.develop" | "sfx.city.upgrade" | "sfx.city.capture" | "sfx.research" | "sfx.discovery"
  | "sfx.treaty.offer" | "sfx.treaty.accept" | "sfx.treaty.break"
  | "sfx.convert" | "sfx.sabotage" | "sfx.freeze" | "sfx.thaw" | "sfx.poison" | "sfx.burn";

export type Music = "music.campaign.calm" | "music.campaign.tense";

/** Stand-ins: a few notes or a puff of noise each, quiet and short. */
type Voice = { tones?: [freq: number, at: number, dur: number, type?: OscillatorType][]; noise?: [at: number, dur: number, freq: number][]; gain?: number };
const VOICES: Record<Sfx, Voice> = {
  "sfx.ui.select": { tones: [[660, 0, 0.05, "triangle"]], gain: 0.25 },
  "sfx.ui.confirm": { tones: [[520, 0, 0.06, "triangle"], [780, 0.06, 0.08, "triangle"]], gain: 0.3 },
  "sfx.turn.warning": { tones: [[880, 0, 0.09, "sine"], [880, 0.18, 0.09, "sine"]], gain: 0.35 },
  "sfx.unit.move": { noise: [[0, 0.05, 900], [0.09, 0.05, 700]], gain: 0.35 },
  "sfx.unit.move.mounted": { noise: [[0, 0.04, 600], [0.07, 0.04, 500], [0.14, 0.04, 600]], gain: 0.35 },
  "sfx.unit.move.water": { noise: [[0, 0.22, 400]], gain: 0.3 },
  "sfx.combat.melee": { noise: [[0, 0.08, 2400]], tones: [[180, 0, 0.1, "square"]], gain: 0.4 },
  "sfx.combat.ranged": { noise: [[0, 0.12, 3500]], tones: [[900, 0, 0.04, "triangle"]], gain: 0.3 },
  "sfx.combat.siege": { noise: [[0, 0.25, 250]], tones: [[70, 0, 0.25, "sine"]], gain: 0.5 },
  "sfx.combat.naval": { noise: [[0, 0.2, 500]], tones: [[110, 0, 0.18, "sawtooth"]], gain: 0.35 },
  "sfx.unit.defeat": { tones: [[330, 0, 0.12, "triangle"], [220, 0.12, 0.2, "triangle"]], gain: 0.35 },
  "sfx.unit.heal": { tones: [[523, 0, 0.1, "sine"], [659, 0.08, 0.14, "sine"]], gain: 0.3 },
  "sfx.unit.promote": { tones: [[523, 0, 0.08, "triangle"], [659, 0.08, 0.08, "triangle"], [784, 0.16, 0.16, "triangle"]], gain: 0.3 },
  "sfx.unit.embark": { noise: [[0, 0.18, 350]], tones: [[260, 0.05, 0.12, "sine"]], gain: 0.3 },
  "sfx.unit.disembark": { noise: [[0, 0.1, 800], [0.12, 0.06, 900]], gain: 0.3 },
  "sfx.unit.upgrade": { tones: [[392, 0, 0.1, "square"], [523, 0.1, 0.12, "square"]], gain: 0.2 },
  "sfx.city.develop": { noise: [[0, 0.04, 1500], [0.1, 0.04, 1500]], tones: [[440, 0.15, 0.08, "triangle"]], gain: 0.3 },
  "sfx.city.upgrade": { tones: [[392, 0, 0.12, "triangle"], [523, 0.1, 0.12, "triangle"], [659, 0.2, 0.25, "triangle"]], gain: 0.35 },
  "sfx.city.capture": { tones: [[294, 0, 0.12, "square"], [392, 0.12, 0.12, "square"], [587, 0.24, 0.3, "square"]], gain: 0.2 },
  "sfx.research": { tones: [[784, 0, 0.1, "sine"], [1047, 0.1, 0.2, "sine"]], gain: 0.25 },
  "sfx.discovery": { tones: [[659, 0, 0.08, "sine"], [880, 0.08, 0.08, "sine"], [1175, 0.16, 0.16, "sine"]], gain: 0.25 },
  "sfx.treaty.offer": { tones: [[440, 0, 0.15, "sine"], [554, 0.15, 0.2, "sine"]], gain: 0.25 },
  "sfx.treaty.accept": { tones: [[440, 0, 0.12, "sine"], [554, 0.1, 0.12, "sine"], [659, 0.2, 0.3, "sine"]], gain: 0.3 },
  "sfx.treaty.break": { tones: [[392, 0, 0.15, "sawtooth"], [277, 0.15, 0.3, "sawtooth"]], gain: 0.2 },
  "sfx.convert": { tones: [[349, 0, 0.2, "sine"], [523, 0.1, 0.3, "sine"]], gain: 0.25 },
  "sfx.sabotage": { noise: [[0, 0.2, 1200]], tones: [[150, 0, 0.2, "sawtooth"]], gain: 0.3 },
  "sfx.freeze": { tones: [[1568, 0, 0.12, "sine"], [2093, 0.05, 0.2, "sine"]], noise: [[0, 0.15, 6000]], gain: 0.2 },
  "sfx.thaw": { noise: [[0, 0.3, 500]], gain: 0.25 },
  "sfx.poison": { tones: [[220, 0, 0.15, "sawtooth"], [207, 0.12, 0.15, "sawtooth"]], gain: 0.15 },
  "sfx.burn": { noise: [[0, 0.35, 1800]], gain: 0.35 },
};

const manifest = manifestJson as unknown as AssetManifest;
// Recordings are bundled lazily, like sprites: nothing downloads until it plays.
const files = import.meta.glob<string>("./assets/audio/**/*.{mp3,ogg,opus,wav}", { query: "?url", import: "default" });
const byUrl = new Map(Object.entries(files).map(([path, load]) => [path.replace("./assets/", ""), load]));

/** Repeats closer than this are dropped: a computer's turn shouldn't rattle. */
const MIN_GAP_MS: Partial<Record<Sfx, number>> = {
  "sfx.unit.move": 140,
  "sfx.unit.move.mounted": 140,
  "sfx.unit.move.water": 200,
  "sfx.city.develop": 120,
};

class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private last = new Map<Sfx, number>();
  private music: { id: Music; node: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantMusic: Music | null = null;

  constructor() {
    // Same rule as the shell: wake up on the first gesture, not before.
    const wake = () => this.wake();
    window.addEventListener("pointerdown", wake, { once: true, capture: true });
    window.addEventListener("keydown", wake, { once: true, capture: true });
  }

  play(id: Sfx): void {
    if (!audio.settings.sound || !this.wake()) return;
    const now = performance.now();
    const gap = MIN_GAP_MS[id];
    if (gap && now - (this.last.get(id) ?? -Infinity) < gap) return;
    this.last.set(id, now);
    const entry = manifest.audio[id];
    if (entry && byUrl.has(entry.url)) {
      void this.buffer(entry.url).then((b) => (b ? this.sample(b, entry.gain) : this.synth(VOICES[id])));
      return;
    }
    this.synth(VOICES[id]);
  }

  /**
   * The mood the game is in. Only plays when the art track has delivered the
   * loops; until then it's silence, which beats a synthesised loop.
   */
  mood(id: Music | null): void {
    this.wantMusic = id;
    if (!this.ctx) return;
    if (this.music?.id === id) return;
    const old = this.music;
    this.music = null;
    if (old) {
      // Crossfade out over a second.
      old.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      old.node.stop(this.ctx.currentTime + 1.5);
    }
    const entry = id ? manifest.audio[id] : undefined;
    if (!id || !entry || !byUrl.has(entry.url) || !audio.settings.sound) return;
    void this.buffer(entry.url).then((b) => {
      if (!b || !this.ctx || !this.out || this.wantMusic !== id) return;
      const node = this.ctx.createBufferSource();
      node.buffer = b;
      node.loop = true;
      if (entry.loopPoints) [node.loopStart, node.loopEnd] = entry.loopPoints;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(entry.gain * 0.6, this.ctx.currentTime, 0.5);
      node.connect(gain).connect(this.out);
      node.start();
      this.music = { id, node, gain };
    });
  }

  private wake(): boolean {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.connect(this.ctx.destination);
        if (this.wantMusic) this.mood(this.wantMusic);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      this.out!.gain.value = audio.settings.volume * 0.8;
      return this.ctx.state !== "closed";
    } catch {
      return false;
    }
  }

  private buffer(url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = (async () => {
        try {
          const src = await byUrl.get(url)!();
          const data = await (await fetch(src)).arrayBuffer();
          return await this.ctx!.decodeAudioData(data);
        } catch {
          return null;
        }
      })();
      this.buffers.set(url, p);
    }
    return p;
  }

  private sample(b: AudioBuffer, gain: number): void {
    const ctx = this.ctx!;
    const node = ctx.createBufferSource();
    node.buffer = b;
    node.playbackRate.value = 0.97 + Math.random() * 0.06;
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g).connect(this.out!);
    node.start();
  }

  private synth(v: Voice): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.value = v.gain ?? 0.3;
    master.connect(this.out!);
    for (const [freq, at, dur, type = "sine"] of v.tones ?? []) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(1, t0 + at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + at + dur);
      o.connect(g).connect(master);
      o.start(t0 + at);
      o.stop(t0 + at + dur + 0.02);
    }
    for (const [at, dur, freq] of v.noise ?? []) {
      const len = Math.ceil(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = freq;
      src.connect(filter).connect(master);
      src.start(t0 + at);
    }
  }

  destroy(): void {
    this.mood(null);
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** One per view; dropped with it. */
export function createSound(): Sound {
  return new Sound();
}
export type { Sound };
