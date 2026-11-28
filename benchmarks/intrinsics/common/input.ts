// Deterministic inputs for the intrinsics benchmarks: generated text and images, the same bytes on every lane.
// Original code, Apache-2.0 (this repository's licence).

/** A 32-bit linear congruential generator (Numerical Recipes constants). */
export class Lcg {
  state: number;
  constructor(seed: number) { this.state = seed | 0; }
  next(): number { this.state = (Math.imul(this.state, 1664525) + 1013904223) | 0; return this.state >>> 0; }
  /** An integer in [0, n). */
  below(n: number): number { return Math.floor((this.next() / 4294967296) * n); }
  /** A double in [0, 1). */
  unit(): number { return this.next() / 4294967296; }
}

const WORDS = ["the", "compiler", "lowers", "each", "call", "to", "an", "instruction", "when", "module", "imports", "library",
  "function", "returns", "value", "every", "target", "same", "bits", "memory", "buffer", "record", "field", "offset", "array",
  "integer", "float", "half", "atomic", "thread", "worker", "shared", "result", "test", "source", "program", "type", "contract",
  "const", "let", "for", "while", "if", "else", "return", "class", "export", "import", "new", "this"];

/** About `bytes` bytes of ASCII text: words, punctuation and line breaks in a source-code-like mix. */
export function textCorpus(bytes: number, seed: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const rng = new Lcg(seed);
  let at = 0, col = 0;
  while (at < bytes) {
    const w = WORDS[rng.below(WORDS.length)]!;
    for (let i = 0; i < w.length && at < bytes; i++) out[at++] = w.charCodeAt(i);
    col += w.length + 1;
    if (at >= bytes) break;
    const r = rng.below(16);
    const sep = col > 72 || r === 0 ? 10 : r === 1 ? 59 : r === 2 ? 40 : r === 3 ? 41 : r === 4 ? 46 : 32;
    out[at++] = sep;
    if (sep === 10) col = 0;
  }
  return out;
}

/** A width x height RGBA image with flat regions, gradients and noise (what an image codec meets in a UI or a game). */
export function testImage(width: number, height: number, seed: number): Uint8Array {
  const px = new Uint8Array(width * height * 4);
  const rng = new Lcg(seed);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const band = ((x >> 6) + (y >> 6)) & 3;
      if (band === 0) { px[i] = 40; px[i + 1] = 44; px[i + 2] = 52; px[i + 3] = 255; }
      else if (band === 1) { px[i] = x & 0xff; px[i + 1] = y & 0xff; px[i + 2] = (x + y) & 0xff; px[i + 3] = 255; }
      else if (band === 2) { const n = rng.below(24); px[i] = 200 + n; px[i + 1] = 120 + n; px[i + 2] = 60; px[i + 3] = 255; }
      else { px[i] = rng.below(256); px[i + 1] = rng.below(256); px[i + 2] = rng.below(256); px[i + 3] = 128 + rng.below(128); }
    }
  return px;
}

/** FNV-1a over bytes, as an unsigned 32-bit number. */
export function fnv1a(bytes: Uint8Array, length = bytes.length): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < length; i++) h = Math.imul(h ^ bytes[i]!, 16777619);
  return h >>> 0;
}
