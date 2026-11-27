import binaryen from "binaryen";
import { describe, expect, test } from "vitest";
import { jsonDecimal, powerOfFive128, JSON_Q_MIN, JSON_Q_MAX } from "./json-number.js";

/* JSON.parse's in-module numbers against V8's Number(): every answer the module gives is the same double (Object.is,
 * so -0 too), and the module defers (NaN) only where json-number.ts says it does. */

interface WasmEngine {
  Module: new (bytes: Uint8Array) => object;
  Instance: new (module: object, imports: object) => { exports: Record<string, unknown> };
}
const engine: WasmEngine = Reflect.get(globalThis, "WebAssembly");

/** The routine over a code-unit buffer: put(i, c) writes the text, parse(len) reads src[0, len). */
/** The compiler's feature set (emitter.ts FEATURES), the one its optimizer runs under. */
const FEATURES = binaryen.Features.GC | binaryen.Features.ReferenceTypes | binaryen.Features.ExceptionHandling | binaryen.Features.BulkMemory
  | binaryen.Features.SignExt | binaryen.Features.NontrappingFPToInt | binaryen.Features.Multivalue | binaryen.Features.TailCall
  | binaryen.Features.MutableGlobals | binaryen.Features.SIMD128 | binaryen.Features.BulkMemoryOpt | binaryen.Features.ExtendedConst;
const build = (optimize: boolean): ((text: string) => number) => {
  const m = new binaryen.Module();
  m.setFeatures(FEATURES);
  const b = new binaryen.TypeBuilder(1);
  b.setArrayType(0, binaryen.i32, binaryen.i16, true);
  const heap = b.buildAndDispose()[0]!;
  const srcType = binaryen.getTypeFromHeapType(heap, false);
  m.addGlobal("buf", srcType, false, m.array.new_default(heap, m.i32.const(4096)));
  const helpers = new Set<string>();
  const defineHelper = (name: string, define: () => void): string => { if (!helpers.has(name)) { helpers.add(name); define(); } return name; };
  const decimal = jsonDecimal({ m, defineHelper, srcType, codeAt: (s, i) => m.array.get(s, i, binaryen.i32, false) });
  m.addFunction("put", binaryen.createType([binaryen.i32, binaryen.i32]), binaryen.none, [],
    m.array.set(m.global.get("buf", srcType), m.local.get(0, binaryen.i32), m.local.get(1, binaryen.i32)));
  m.addFunction("parse", binaryen.createType([binaryen.i32]), binaryen.f64, [],
    m.call(decimal, [m.global.get("buf", srcType), m.i32.const(0), m.local.get(0, binaryen.i32)], binaryen.f64));
  m.addFunctionExport("put", "put");
  m.addFunctionExport("parse", "parse");
  expect(m.validate()).toBeTruthy();
  // As the compiler finishes a module: optimized, then valid still (a shared expression node would break here).
  if (optimize) { binaryen.setOptimizeLevel(2); binaryen.setShrinkLevel(0); m.optimize(); expect(m.validate()).toBeTruthy(); }
  const bin = m.emitBinary();
  m.dispose();
  const ex = new engine.Instance(new engine.Module(bin), {}).exports as { put: (i: number, c: number) => void; parse: (n: number) => number };
  return (text) => {
    for (let i = 0; i < text.length; i++) ex.put(i, text.charCodeAt(i));
    return ex.parse(text.length);
  };
};
const plain = build(false), optimized = build(true);
/** The routine's answer, the same from the plain and the optimized module. */
const parse = (text: string): number => {
  const a = plain(text), b = optimized(text);
  if (!Object.is(a, b)) expect.fail(`${text}: plain ${a}, optimized ${b}`);
  return a;
};

/** Every answer exact; returns how many were deferred. */
const check = (texts: Iterable<string>): { n: number; deferred: number } => {
  let n = 0, deferred = 0;
  for (const t of texts) {
    n++;
    const got = parse(t), want = Number(t);
    if (Number.isNaN(got)) { deferred++; continue; }
    if (!Object.is(got, want)) expect.fail(`${t}: module ${got}, Number() ${want}`);
  }
  return { n, deferred };
};

/** A deterministic generator (xorshift64*), so a failure reproduces. */
const rng = (seed: bigint) => {
  let s = seed;
  return (): bigint => {
    s ^= s >> 12n; s ^= (s << 25n) & 0xffffffffffffffffn; s ^= s >> 27n;
    return (s * 0x2545f4914f6cdd1dn) & 0xffffffffffffffffn;
  };
};
const f64bits = new DataView(new ArrayBuffer(8));
const fromBits = (b: bigint): number => { f64bits.setBigUint64(0, b); return f64bits.getFloat64(0); };
const toBits = (x: number): bigint => { f64bits.setFloat64(0, x); return f64bits.getBigUint64(0); };

describe("JSON numbers in the module", () => {
  test("the 128-bit powers of five are fast_float's", () => {
    const at = (q: number) => powerOfFive128(q, q).map(v => v.toString(16));
    expect(at(-342)).toEqual(["eef453d6923bd65a", "113faa2906a13b3f"]);
    expect(at(-1)).toEqual(["cccccccccccccccc", "cccccccccccccccd"]);
    expect(at(0)).toEqual(["8000000000000000", "0"]);
    expect(at(1)).toEqual(["a000000000000000", "0"]);
  });

  test("signs, zeros, fractions and exponents", () => {
    const cases = ["0", "-0", "0.0", "-0.0", "0e0", "-0e-0", "0E+5", "-0.000e99999", "1", "-1", "0.1", "-0.1", "0.5", "1.5", "123", "123.456",
      "-123.456e-7", "1e0", "1E1", "1e+22", "1e22", "1e23", "1e-22", "1e-23", "9007199254740992", "9007199254740993", "9007199254740994",
      "9007199254740995", "18014398509481985", "4503599627370497.5", "4503599627370496.5", "2251799813685248.25", "0.30000000000000004",
      "0.1e1", "100e-2", "0.000001", "1e-7", "123456789012345678", "1234567890123456789", "12345678901234567890", "1.7976931348623157e308",
      "2.2250738585072014e-308", "5e-324", "1e-100", "1e100", "1e-101", "1e101", "9999999999999999999e-119", "1e-400", "1e400", "-1e400",
      "0.0000000000000000000000000000001", "3.141592653589793", "2.718281828459045", "1.0000000000000002", "0.9999999999999999",
      "123456.789e3", "1e1000000000", "0.00000000000000000000000000000000000000000000000001e50", "7.2057594037927933e16", "1448997445238699",
      "8.98846567431158e307", "4.9406564584124654e-324"];
    check(cases);
    // Deferred: the 308-power edges, 10^±101 and beyond the table, the exponents past 10^4.
    expect(cases.filter(t => Number.isNaN(parse(t)))).toEqual(["1.7976931348623157e308", "2.2250738585072014e-308", "5e-324", "1e-101", "1e101", "9999999999999999999e-119",
      "1e-400", "1e400", "-1e400", "1e1000000000", "8.98846567431158e307", "4.9406564584124654e-324"]);
  });

  test("the shortest text of 200k doubles, exponents spread", () => {
    const next = rng(0x9e3779b97f4a7c15n);
    const texts: string[] = [];
    for (let k = 0; k < 200_000; k++) {
      // Biased exponents 1023 +- 400 (10^±120): both sides of the table's edge.
      const exp = 1023n + (next() % 801n) - 400n, sign = next() & 1n;
      const x = fromBits((sign << 63n) | (exp << 52n) | (next() & ((1n << 52n) - 1n)));
      texts.push(JSON.stringify(x));
    }
    const { n, deferred } = check(texts);
    // About a sixth of the exponents fall outside 10^±100.
    expect(deferred / n).toBeLessThan(0.25);
  });

  test("game-like numbers are all decided in the module", () => {
    const next = rng(0x1234567n);
    const texts: string[] = [];
    for (let k = 0; k < 100_000; k++) {
      const u = Number(next() >> 11n) / 2 ** 53;
      const scale = 10 ** (Number(next() % 12n) - 6);
      const x = (u - 0.3) * scale;
      texts.push(JSON.stringify(x), JSON.stringify(Math.fround(x)), JSON.stringify(Math.round(x * 1000) / 1000), String(Number(next() % 100000n)));
    }
    const { deferred } = check(texts);
    expect(deferred).toBe(0);
  });

  test("halfway points round to even, and their neighbours away", () => {
    const next = rng(0xdeadbeefn);
    const texts: string[] = [];
    for (let k = 0; k < 50_000; k++) {
      // An integer double in [2^53, 2^63): its ulp is a power of two >= 2; the midpoint and the integers beside it.
      const e = 53n + (next() % 10n), ulp = 1n << (e - 52n);
      const x = ((1n << e) + (next() % (1n << e))) & ~(ulp - 1n);
      const mid = x + ulp / 2n;
      texts.push(mid.toString(), (mid - 1n).toString(), (mid + 1n).toString());
      // A double in [2^50, 2^53) with a fractional ulp: the midpoint's exact decimal (q = -1 .. -3).
      const f = 50n + (next() % 3n), fulp = 1n << (52n - f); // 1/fulp is the ulp
      const y = (1n << f) * fulp + (next() % ((1n << f) * fulp)); // in ulps
      const midUlps2 = 2n * y + 1n; // the midpoint in half-ulps
      const denom = 2n * fulp;
      const whole = midUlps2 / denom, rem = midUlps2 % denom;
      let digits = "", r = rem, places = 0;
      while (r !== 0n) { r *= 10n; digits += (r / denom).toString(); r %= denom; places++; }
      if (places) texts.push(`${whole}.${digits}`);
    }
    // And midpoints scaled by powers of ten that keep them exact: halfway with q in [-4, 23].
    for (let k = 0; k < 20_000; k++) {
      const x = fromBits(0x4340000000000000n + (next() % (1n << 52n)) + 0n); // [2^53, 2^54): ulp 2
      const mid = BigInt(x) + 1n;
      const z = Number(next() % 6n);
      texts.push(`${mid}${"0".repeat(z)}e-${z}`);
    }
    const { deferred } = check(texts);
    expect(deferred).toBe(0);
  });

  test("random digit strings: lengths 1..25, points anywhere, exponents to ±130", () => {
    const next = rng(0xabcdefn);
    const texts: string[] = [];
    for (let k = 0; k < 200_000; k++) {
      const len = 1 + Number(next() % 25n);
      let d = "";
      for (let i = 0; i < len; i++) d += String(Number(next() % 10n));
      if (d.length > 1) d = (d[0] === "0" ? String(1 + Number(next() % 9n)) : d[0]) + d.slice(1);
      const point = Number(next() % BigInt(len + 1));
      let t = point === 0 || point === len ? d : `${d.slice(0, point)}.${d.slice(point)}`;
      if (t.startsWith(".")) t = `0${t}`;
      if (next() & 1n) t += `e${next() & 1n ? "-" : ""}${Number(next() % 130n)}`;
      if (next() & 1n) t = `-${t}`;
      texts.push(t);
      // Leading zeros in the fraction.
      texts.push(`0.${"0".repeat(Number(next() % 30n))}${d}`);
    }
    check(texts);
  });

  test("every bit pattern's neighbours: x, nextUp, nextDown in shortest and 17-digit text", () => {
    const next = rng(0x5151n);
    const texts: string[] = [];
    for (let k = 0; k < 50_000; k++) {
      const exp = 1023n + (next() % 601n) - 300n;
      const b = (exp << 52n) | (next() & ((1n << 52n) - 1n));
      for (const v of [b - 1n, b, b + 1n]) {
        const x = fromBits(v);
        texts.push(String(x), x.toPrecision(17), x.toExponential(18));
      }
    }
    check(texts);
    expect(toBits(parse("1"))).toBe(0x3ff0000000000000n);
  });

  test("the table spans the decided exponents", () => {
    expect(powerOfFive128(JSON_Q_MIN, JSON_Q_MAX).length).toBe(2 * (JSON_Q_MAX - JSON_Q_MIN + 1));
  });
});
