// Reads the length and shape of an mp3 from its frame headers. Plain JS with
// no imports, so the server and the tests share it. It does not decode audio.

const V1_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const V2_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const V1_RATES = [44100, 48000, 32000];
const V2_RATES = [22050, 24000, 16000];
const V25_RATES = [11025, 12000, 8000];

/** `{ ms, mono, sampleRate, frames }` of the first run of valid layer III frames, or null. */
export function readMp3(bytes) {
  let at = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    at = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }
  let frames = 0;
  let samples = 0;
  let first = null;
  while (at + 4 <= bytes.length) {
    if (bytes[at] === 0x54 && bytes[at + 1] === 0x41 && bytes[at + 2] === 0x47) break;
    const b0 = bytes[at];
    const b1 = bytes[at + 1];
    const b2 = bytes[at + 2];
    const b3 = bytes[at + 3];
    if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) break;
    const version = (b1 >> 3) & 3;
    if (version === 1 || ((b1 >> 1) & 3) !== 1) break;
    const rateIndex = (b2 >> 2) & 3;
    const kbpsIndex = b2 >> 4;
    if (rateIndex === 3 || kbpsIndex === 0 || kbpsIndex === 15) break;
    const v1 = version === 3;
    const rate = (v1 ? V1_RATES : version === 2 ? V2_RATES : V25_RATES)[rateIndex];
    const kbps = (v1 ? V1_KBPS : V2_KBPS)[kbpsIndex];
    const length = Math.floor(((v1 ? 144000 : 72000) * kbps) / rate) + ((b2 >> 1) & 1);
    first ??= { mono: b3 >> 6 === 3, sampleRate: rate };
    frames++;
    samples += (v1 ? 1152 : 576) / rate;
    at += length;
  }
  if (!first) return null;
  return { ms: Math.round(samples * 1000), mono: first.mono, sampleRate: first.sampleRate, frames };
}
