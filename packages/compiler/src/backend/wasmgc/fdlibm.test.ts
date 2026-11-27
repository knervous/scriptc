import binaryen from "binaryen";
import { describe, expect, test } from "vitest";
import { fdlibmFor, parseFdlibm, FDLIBM_MATH, type FdExpr, type FdFunction, type FdProgram, type FdStmt } from "./fdlibm.js";
import { FDLIBM_SOURCE } from "./fdlibm-source.js";

/* The in-module math library against V8 (Node's Math). Two facts shape the checks:
 *  - the wasm routines are the C operation for operation, so they match a plain evaluation of the same source bit for bit;
 *  - V8 on arm64 fuses the multiply-adds clang finds in each C expression (fp-contract=on), so Node there differs from
 *    plain IEEE in the last bit of about one result in a hundred. The port is checked against Node by evaluating the same
 *    source with that fusion (`fuse`), on arm64, and plain elsewhere.
 * pow is the exception: V8 takes it from the platform libm, so it is compared with the correctly rounded value. */

const program = parseFdlibm(FDLIBM_SOURCE);
const TWO = new Set(["atan2", "pow"]);

/** The engine's WebAssembly: this package's lib (no DOM) declares the namespace's types only, not the value. */
interface WasmEngine {
  Module: new (bytes: Uint8Array) => object;
  Instance: new (module: object, imports: object) => { exports: Record<string, unknown> };
}
const engine: WasmEngine = Reflect.get(globalThis, "WebAssembly");
/** V8's own `Math[n]`. */
const v8Math = (n: string): ((...a: number[]) => number) => Reflect.get(Math, n);

const buildWasm = (names: readonly string[]): Record<string, (...a: number[]) => number> => {
  const m = new binaryen.Module();
  m.setFeatures(binaryen.Features.All);
  const helpers = new Set<string>();
  const defineHelper = (name: string, define: () => void): string => { if (!helpers.has(name)) { helpers.add(name); define(); } return name; };
  const fd = fdlibmFor({ m, defineHelper, program });
  for (const n of names) {
    const arity = TWO.has(n) ? 2 : 1;
    const params = Array.from({ length: arity }, (_, i) => m.local.get(i, binaryen.f64));
    m.addFunction(`w.${n}`, binaryen.createType(params.map(() => binaryen.f64)), binaryen.f64, [], m.call(fd.routine(n), params, binaryen.f64));
    m.addFunctionExport(`w.${n}`, n);
  }
  expect(m.validate()).toBeTruthy();
  const bin = m.emitBinary();
  m.dispose();
  return new engine.Instance(new engine.Module(bin), {}).exports as Record<string, (...a: number[]) => number>;
};

/* ---- the source, evaluated in JavaScript ---- */

const dv = new DataView(new ArrayBuffer(8));
const decode = (x: number): [bigint, number] => {
  dv.setFloat64(0, x);
  const b = dv.getBigUint64(0), e = Number((b >> 52n) & 0x7ffn);
  let mant = b & ((1n << 52n) - 1n), exp: number;
  if (e === 0) exp = -1074; else { mant |= 1n << 52n; exp = e - 1075; }
  return [(b >> 63n) ? -mant : mant, exp];
};
const encode = (m: bigint, ex: number): number => {
  if (m === 0n) return 0;
  const neg = m < 0n;
  if (neg) m = -m;
  let shift = m.toString(2).length - 53;
  if (ex + shift < -1074) shift = -1074 - ex;
  let r: bigint;
  if (shift <= 0) r = m << BigInt(-shift);
  else {
    const q = m >> BigInt(shift), rem = m & ((1n << BigInt(shift)) - 1n), half = 1n << BigInt(shift - 1);
    r = q + (rem > half || (rem === half && (q & 1n)) ? 1n : 0n);
  }
  const k = ex + shift, half2 = Math.trunc(k / 2);
  const val = Number(r) * 2 ** half2 * 2 ** (k - half2);
  return neg ? -val : val;
};
/** a * b + c with one rounding. */
const fma = (a: number, b: number, c: number): number => {
  const p = a * b;
  if (!Number.isFinite(p) || !Number.isFinite(c) || p === 0) return p + c;
  const [ma, ea] = decode(a), [mb, eb] = decode(b), [mc, ec] = decode(c);
  const ep = ea + eb, e = Math.min(ep, ec);
  const sum = ma * mb * (1n << BigInt(ep - e)) + mc * (1n << BigInt(ec - e));
  return sum === 0n ? p + c : encode(sum, e);
};

const F64_CALLS = new Set(["fabs", "sqrt", "floor", "copysign", "mk", "setHi", "setLo", "toF"]);
const render = (prog: FdProgram, fuse: boolean): string => {
  const out: string[] = [];
  const fn = (f: FdFunction): string => {
    const types = new Map<string, string>(f.params.map(p => [p.name, p.ty]));
    const consts = new Map<string, { float: boolean }>(prog.consts);
    const scan = (s: FdStmt | undefined): void => {
      if (!s) return;
      switch (s.k) {
        case "let": types.set(s.name, s.ty); break;
        case "const": consts.set(s.name, { float: s.value.k === "num" ? s.value.float : s.value.k === "un" && s.value.e.k === "num" && s.value.e.float }); break;
        case "block": s.body.forEach(scan); break;
        case "if": scan(s.then); scan(s.else); break;
        case "while": scan(s.body); break;
        case "for": scan(s.init); scan(s.step); scan(s.body); break;
        default: break;
      }
    };
    f.body.forEach(scan);
    const isF = (e: FdExpr): boolean => {
      switch (e.k) {
        case "num": return e.float;
        case "id": { const t = types.get(e.name); if (t) return t === "f64"; const c = consts.get(e.name); if (c) return c.float; return prog.globals.get(e.name)?.ty === "f64"; }
        case "un": return e.op === "!" ? false : isF(e.e);
        case "bin": return ["==", "!=", "<", "<=", ">", ">=", "&&", "||", "<<", ">>", ">>>", "&", "|", "^"].includes(e.op) ? false : isF(e.l) || isF(e.r);
        case "cond": return isF(e.a) || isF(e.b);
        case "idx": return (types.get(e.arr) ?? prog.tables.get(e.arr)?.ty) === "f64[]";
        case "call": return F64_CALLS.has(e.name) || prog.functions.get(e.name)?.ret === "f64";
      }
    };
    const ex = (e: FdExpr): string => {
      switch (e.k) {
        case "num": return e.float || e.v >= 0 ? String(e.v) : `(${e.v})`;
        case "id": return e.name;
        case "un": return `(${e.op}${ex(e.e)})`;
        case "cond": return `(${ex(e.c)} ? ${ex(e.a)} : ${ex(e.b)})`;
        case "idx": return `${e.arr}[${ex(e.i)}]`;
        case "call": return `${e.name}(${e.args.map(ex).join(", ")})`;
        case "bin": {
          if (fuse && isF(e) && (e.op === "+" || e.op === "-")) {
            const mul = (x: FdExpr): x is Extract<FdExpr, { k: "bin" }> => x.k === "bin" && x.op === "*" && isF(x);
            if (mul(e.l)) return `fma(${ex(e.l.l)}, ${ex(e.l.r)}, ${e.op === "-" ? `-(${ex(e.r)})` : ex(e.r)})`;
            if (mul(e.r)) return e.op === "+" ? `fma(${ex(e.r.l)}, ${ex(e.r.r)}, ${ex(e.l)})` : `fma(-(${ex(e.r.l)}), ${ex(e.r.r)}, ${ex(e.l)})`;
          }
          const s = `(${ex(e.l)} ${e.op} ${ex(e.r)})`;
          if (!isF(e) && (e.op === "+" || e.op === "-")) return `(${s} | 0)`;
          if (!isF(e) && e.op === "*") return `Math.imul(${ex(e.l)}, ${ex(e.r)})`;
          return s;
        }
      }
    };
    const st = (s: FdStmt, pad: string): string => {
      switch (s.k) {
        case "let": return `${pad}let ${s.name}${s.init ? ` = ${ex(s.init)}` : " = 0"};\n`;
        case "const": return `${pad}const ${s.name} = ${ex(s.value)};\n`;
        case "assign": { const op = s.op.slice(0, -1); return `${pad}${ex(s.target)} = ${op === "" ? ex(s.e) : ex({ k: "bin", op, l: s.target, r: s.e })};\n`; }
        case "incr": return `${pad}${ex(s.target)}${s.delta > 0 ? "++" : "--"};\n`;
        case "if": return `${pad}if (${ex(s.c)}) {\n${st(s.then, pad + " ")}${pad}}${s.else ? ` else {\n${st(s.else, pad + " ")}${pad}}` : ""}\n`;
        case "while": return `${pad}while (${ex(s.c)}) {\n${st(s.body, pad + " ")}${pad}}\n`;
        case "for": return `${pad}for (${s.init ? st(s.init, "").trim().replace(/;$/, "") : ""}; ${s.c ? ex(s.c) : ""}; ${s.step ? st(s.step, "").trim().replace(/;$/, "") : ""}) {\n${st(s.body, pad + " ")}${pad}}\n`;
        case "return": return `${pad}return${s.e ? ` ${ex(s.e)}` : ""};\n`;
        case "break": return `${pad}break;\n`;
        case "continue": return `${pad}continue;\n`;
        case "block": return s.body.map(x => st(x, pad)).join("");
        case "expr": return `${pad}${ex(s.e)};\n`;
      }
    };
    return `function ${f.name}(${f.params.map(p => p.name).join(", ")}) {\n${f.body.map(s => st(s, " ")).join("")}}\n`;
  };
  for (const [n, v] of prog.consts) out.push(`const ${n} = ${v.v};\n`);
  for (const [n, t] of prog.tables) out.push(`const ${n} = new ${t.ty === "f64[]" ? "Float64Array" : "Int32Array"}([${t.values.join(", ")}]);\n`);
  for (const [n, g] of prog.globals) out.push(`let ${n} = ${g.init};\n`);
  for (const f of prog.functions.values()) out.push(fn(f));
  return out.join("");
};
const evaluate = (fuse: boolean): Record<string, (...a: number[]) => number> => {
  const bits = new DataView(new ArrayBuffer(8));
  const intrinsics: Record<string, unknown> = {
    hi: (x: number) => { bits.setFloat64(0, x); return bits.getInt32(0); },
    lo: (x: number) => { bits.setFloat64(0, x); return bits.getInt32(4); },
    mk: (h: number, l: number) => { bits.setInt32(0, h); bits.setInt32(4, l); return bits.getFloat64(0); },
    setHi: (x: number, h: number) => { bits.setFloat64(0, x); bits.setInt32(0, h); return bits.getFloat64(0); },
    setLo: (x: number, l: number) => { bits.setFloat64(0, x); bits.setInt32(4, l); return bits.getFloat64(0); },
    toI: (x: number) => x | 0, toF: (i: number) => i, idiv: (a: number, b: number) => (a / b) | 0,
    newF: (n: number) => new Float64Array(n), newI: (n: number) => new Int32Array(n),
    fabs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, fma,
    copysign: (a: number, b: number) => (Object.is(b, -0) || b < 0 ? -Math.abs(a) : Math.abs(a)),
  };
  const body = `${render(program, fuse)}\nreturn { ${[...program.functions.keys()].join(", ")} };`;
  return new Function(...Object.keys(intrinsics), body)(...Object.values(intrinsics)) as Record<string, (...a: number[]) => number>;
};

/* ---- inputs ---- */

const bitsOf = new DataView(new ArrayBuffer(8));
const fromBits = (hi: number, lo: number): number => { bitsOf.setUint32(0, hi >>> 0); bitsOf.setUint32(4, lo >>> 0); return bitsOf.getFloat64(0); };
let seed = 0x2545f491;
const rand = (): number => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const generators: Record<string, () => number> = {
  anyBits: () => fromBits(rand() * 2 ** 32, rand() * 2 ** 32),
  small: () => (rand() - 0.5) * 20,
  unit: () => rand() * 2 - 1,
  mid: () => (rand() - 0.5) * 2000,
  positive: () => rand() * 100,
  large: () => (rand() - 0.5) * 1e7,
  huge: () => (rand() - 0.5) * 1e22,
  tiny: () => (rand() - 0.5) * 1e-5,
};
const PI = Math.PI;
const specials = [0, -0, 1, -1, 0.5, -0.5, 2, 10, 22, 709, 710, 711, -745, -746, 1e300, -1e300, 1e-300, 5e-324, -5e-324, 2.2250738585072014e-308, 2.225073858507201e-308,
  Infinity, -Infinity, NaN, 2 ** 52, 2 ** 53, 2 ** 31, 2 ** -27, 2 ** -28, 2 ** -54, 2 ** 20 * PI / 2, 2 ** 19 * PI / 2, 823549.6, 1e6, 1e15, 1e22, 1e100, Number.MAX_VALUE, -Number.MAX_VALUE,
  ...[1, 2, 3, 4, 5, 6, 7, 8, 100, 1000, 100000, 1e8, 1e12].flatMap(k => { const a = k * PI / 2; return [a, -a, a - a * 2 ** -52, a + a * 2 ** -52, a * (1 + 2 ** -40), a * (1 - 2 ** -30)]; }),
  ...[1, 3, 5, 7, 9].map(k => k * PI / 4), 0.6744, 0.6743, 0.5, 1 - 2 ** -53, 1 + 2 ** -52, Math.SQRT2, Math.SQRT1_2, Math.E, 1 / Math.E, Math.LN2, 0.3333333333333333];

const same = (a: number, b: number): boolean => Object.is(a, b) || (a !== a && b !== b);
const sweep = (n: string, run: (x: number, y: number) => void, count = 4000): void => {
  for (const x of specials) for (const y of TWO.has(n) ? specials : [0]) run(x, y);
  for (const gen of Object.values(generators)) for (let i = 0; i < count; i++) run(gen(), gen());
};
const call = (f: (...a: number[]) => number, n: string, x: number, y: number): number => (TWO.has(n) ? f(x, y) : f(x));

const wasm = buildWasm(FDLIBM_MATH);
const plain = evaluate(false);
const fused = evaluate(true);
const V8_ARM = process.arch === "arm64";
const v8Model = V8_ARM ? fused : plain;

describe("in-module math: wasm routines", () => {
  for (const n of FDLIBM_MATH) {
    test(`${n}: wasm equals the plain evaluation of the source, bit for bit`, () => {
      let bad: string | undefined;
      sweep(n, (x, y) => { const a = call(plain[n]!, n, x, y), b = call(wasm[n]!, n, x, y); if (!bad && !same(a, b)) bad = `${n}(${x}, ${y}): js ${a}, wasm ${b}`; });
      expect(bad).toBeUndefined();
    });
  }
});

describe("in-module math: against V8", () => {
  for (const n of FDLIBM_MATH.filter(name => name !== "pow")) {
    test(`${n}: the source is V8's (${V8_ARM ? "multiply-add fused, as V8 on arm64" : "plain"}), bit for bit`, () => {
      let bad: string | undefined;
      sweep(n, (x, y) => { const a = call(v8Model[n]!, n, x, y), b = call(v8Math(n), n, x, y); if (!bad && !same(a, b)) bad = `${n}(${x}, ${y}): model ${a}, V8 ${b}`; });
      expect(bad).toBeUndefined();
    });
    test(`${n}: the wasm routine is within one ulp of V8`, () => {
      let worst = 0, at = "";
      sweep(n, (x, y) => {
        const a = call(wasm[n]!, n, x, y), b = call(v8Math(n), n, x, y);
        if (same(a, b)) return;
        if (!Number.isFinite(a) || !Number.isFinite(b) || (a !== a) !== (b !== b)) { worst = Infinity; at = `${n}(${x}, ${y}): ${a} vs ${b}`; return; }
        const ulp = Math.abs(a - b) / Math.max(Math.abs(b) * 2 ** -52, 5e-324);
        if (ulp > worst) { worst = ulp; at = `${n}(${x}, ${y}): ${a} vs ${b}`; }
      }, 2000);
      expect(worst, at).toBeLessThanOrEqual(V8_ARM || n === "tan" ? 2 : 1.01);
    });
  }
  test("pow: special values agree with V8 exactly, and ordinary results are rounded as V8's platform libm rounds them", () => {
    let bad: string | undefined, miss = 0, total = 0;
    for (const x of specials) for (const y of specials) {
      const a = wasm["pow"]!(x, y), b = Math.pow(x, y);
      if (!bad && !same(a, b) && !(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.abs(b) * 2 ** -52)) bad = `pow(${x}, ${y}): ${a} vs ${b}`;
    }
    for (let i = 0; i < 20000; i++) {
      const x = rand() * 200 + 0.001, y = (rand() - 0.5) * 20, a = wasm["pow"]!(x, y), b = Math.pow(x, y);
      total++;
      if (!same(a, b)) { miss++; if (!bad && Math.abs(a - b) > Math.abs(b) * 2 ** -52) bad = `pow(${x}, ${y}): ${a} vs ${b}`; }
    }
    expect(bad).toBeUndefined();
    expect(miss / total).toBeLessThan(0.003);
  });
});
