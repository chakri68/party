/*! The mp3 encoder is LAME (LGPL-2.0) built to WebAssembly by wasm-media-encoders (MIT). It loads only in its own lazy chunk.
 * wasm-media-encoders: Copyright (c) 2020-2024 arseneyr, MIT License. https://github.com/arseneyr/wasm-media-encoders
 * LAME: LGPL-2.0. Source: https://lame.sourceforge.io/ Licence: https://www.gnu.org/licenses/old-licenses/lgpl-2.0.html
 * See /THIRD_PARTY.md.
 */

// Keep this the only file that imports wasm-media-encoders, and import this file only from the lazy My sounds view.
import { createMp3Encoder } from "wasm-media-encoders";
import { type PreparedClip, SAMPLE_RATE } from "./process.ts";

/** Samples per encode call: four mp3 frames of 1152. */
const CHUNK = 4608;

/** Decodes any audio the browser can read, resampled to SAMPLE_RATE. `null` when it cannot. */
export async function decodeFile(bytes: ArrayBuffer): Promise<{ channels: Float32Array[]; sampleRate: number } | null> {
  try {
    const audio = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
    if (channels.length === 0 || channels[0]!.length === 0) return null;
    return { channels, sampleRate: audio.sampleRate };
  } catch {
    return null;
  }
}

/** Mono 64 kbps CBR mp3 at the clip's rate. */
export async function encodeMp3(clip: PreparedClip): Promise<Uint8Array> {
  const encoder = await createMp3Encoder();
  encoder.configure({ channels: 1, sampleRate: clip.sampleRate, bitrate: 64 });
  const parts: Uint8Array[] = [];
  for (let i = 0; i < clip.samples.length; i += CHUNK) {
    // The encoder owns the view it returns and reuses it, so copy it.
    parts.push(encoder.encode([clip.samples.subarray(i, i + CHUNK)]).slice());
  }
  parts.push(encoder.finalize().slice());
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
