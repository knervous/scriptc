// A closure's captured numbers keep their full double value: a capture is read through a plain local copy
// (ir/capture-values.ts), and that copy must not be typed f32 on the strength of the capture having no writes in the
// closure body. 0xed56aed3 once read back as 3981881088, and a schema-hash check against bytes failed.
function eq(view: DataView, at: number, want: number): boolean { return view.getUint32(at, true) === want; }

function make(lo: number, hi: number): { inline(bytes: Uint8Array): string; passed(bytes: Uint8Array): string; tried(bytes: Uint8Array, index?: number): number | null } {
  return {
    inline(bytes: Uint8Array): string {
      const v = new DataView(bytes.buffer);
      return `${v.getUint32(16, true) === lo} ${v.getUint32(20, true) === hi} ${hi} ${lo}`;
    },
    passed(bytes: Uint8Array): string {
      const v = new DataView(bytes.buffer);
      return `${eq(v, 16, lo)} ${eq(v, 20, hi)}`;
    },
    tried(bytes: Uint8Array, index = 0): number | null {
      try {
        const v = new DataView(bytes.buffer);
        if (!eq(v, 16, lo) || !eq(v, 20, hi)) throw new TypeError("mismatch");
        return index + hi - lo;
      } catch {
        return null;
      }
    },
  };
}

const bytes = new Uint8Array(24);
const w = new DataView(bytes.buffer);
w.setUint32(16, 0xc036e92, true);
w.setUint32(20, 0xed56aed3, true);
const m = make(0xc036e92, 0xed56aed3);
console.log(`inline: ${m.inline(bytes)}`);
console.log(`passed: ${m.passed(bytes)}`);
console.log(`tried: ${m.tried(bytes)}`);

// A fractional capture that f32 cannot hold either.
function scale(by: number): (x: number) => number { return (x) => x * by; }
console.log(`scale: ${scale(0.1)(3)}`);

// Captures from different creation sites.
const makers = [make(1, 2), make(16777217, 4294967295)];
for (const k of makers) console.log(`maker: ${k.inline(bytes)}`);
