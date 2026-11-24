// Builds mp3 bytes for tests: valid frame headers with zero bodies, so no
// .mp3 file has to enter git.
export function fakeMp3(opts: { frames?: number; mono?: boolean; id3?: boolean; mpeg2?: boolean; info?: boolean } = {}): Uint8Array {
  const frames = opts.frames ?? 100;
  const mono = opts.mono ?? true;
  const b3 = mono ? 0xc4 : 0x04;
  // MPEG1 64 kbps 48 kHz: 192 bytes, 24 ms. MPEG2 32 kbps 24 kHz: 96 bytes, 24 ms.
  const header = opts.mpeg2 ? [0xff, 0xf3, 0x44, b3] : [0xff, 0xfb, 0x54, b3];
  const size = opts.mpeg2 ? 96 : 192;
  const tag = opts.id3 ? 10 + 100 : 0;
  const extra = opts.info ? size : 0;
  const out = new Uint8Array(tag + extra + frames * size);
  if (opts.id3) out.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 100]);
  for (let i = 0; i < frames; i++) out.set(header, tag + extra + i * size);
  if (opts.info) {
    out.set(header, tag);
    const at = tag + 4 + (opts.mpeg2 ? (mono ? 9 : 17) : mono ? 17 : 32);
    out.set([0x49, 0x6e, 0x66, 0x6f], at);
  }
  return out;
}
