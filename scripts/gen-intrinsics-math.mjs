// Generates packages/intrinsics/math.ts, the strict-math intrinsic library, from the WasmGC backend's in-module math
// library source (packages/compiler/src/backend/wasmgc/fdlibm-source.ts, V8's fdlibm). The translation keeps every
// operation of the typed subset exact in JavaScript: i32 values stay int32 numbers (`| 0`, Math.imul, `>>> 0` compares),
// the word intrinsics read and write a shared Float64Array, and C's saturating double-to-int cast is spelled out. So the
// generated bodies compute the bits the WasmGC routines compute, on any engine.
//
//   node scripts/gen-intrinsics-math.mjs [--check]     (needs a built compiler: pnpm -r build)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { parseFdlibm, FDLIBM_MATH } = await import(`${root}packages/compiler/dist/backend/wasmgc/fdlibm.js`);
const { FDLIBM_SOURCE } = await import(`${root}packages/compiler/dist/backend/wasmgc/fdlibm-source.js`);
const target = `${root}packages/intrinsics/math.ts`;
const program = parseFdlibm(FDLIBM_SOURCE);

const CMP = ["==", "!=", "<", "<=", ">", ">="];
const num = (v, ty) => (ty === "i32" ? String(v | 0) : Object.is(v, -0) ? "-0" : String(v));
const paren = (s) => `(${s})`;

function translateFunction(f) {
  const locals = new Map(f.params.map((p) => [p.name, p.ty]));
  const consts = new Map();
  const typeOf = (e) => {
    switch (e.k) {
      case "num": return { ty: e.float ? "f64" : "i32", flex: !e.float };
      case "id": {
        if (locals.has(e.name)) return { ty: locals.get(e.name), flex: false };
        const c = consts.get(e.name) ?? program.consts.get(e.name);
        if (c) return { ty: c.float ? "f64" : "i32", flex: false };
        if (program.globals.has(e.name)) return { ty: program.globals.get(e.name).ty, flex: false };
        if (program.tables.has(e.name)) return { ty: program.tables.get(e.name).ty, flex: false };
        throw new Error(`unknown name ${e.name}`);
      }
      case "un": { const t = typeOf(e.e); return e.op === "!" ? { ty: "i32", flex: false } : t; }
      case "bin": {
        if ([...CMP, "&&", "||"].includes(e.op)) return { ty: "i32", flex: false };
        const l = typeOf(e.l), r = typeOf(e.r);
        if (["<<", ">>", ">>>"].includes(e.op)) return { ty: l.ty, flex: l.flex && r.flex };
        if (l.flex && r.flex) return { ty: "i32", flex: true };
        return { ty: l.flex ? r.ty : l.ty, flex: false };
      }
      case "cond": { const a = typeOf(e.a), b = typeOf(e.b); return a.flex && b.flex ? { ty: "i32", flex: true } : { ty: a.flex ? b.ty : a.ty, flex: false }; }
      case "idx": return { ty: arrayTy(e.arr) === "f64[]" ? "f64" : "i32", flex: false };
      case "call": return { ty: callTy(e.name), flex: false };
    }
  };
  const arrayTy = (name) => locals.get(name) ?? program.tables.get(name)?.ty;
  const callTy = (n) => {
    if (["fabs", "sqrt", "floor", "copysign", "mk", "setHi", "setLo", "toF"].includes(n)) return "f64";
    if (["hi", "lo", "toI", "idiv", "irem", "ltu", "geu"].includes(n)) return "i32";
    if (n === "newF") return "f64[]";
    if (n === "newI") return "i32[]";
    return program.functions.get(n).ret;
  };
  /** `e` as JavaScript computing the value the wasm routine computes, as type `want`. */
  const value = (e, want) => {
    switch (e.k) {
      case "num": return num(e.v, want === "f64" || e.float ? "f64" : "i32");
      case "id": {
        const c = !locals.has(e.name) && (consts.get(e.name) ?? program.consts.get(e.name));
        return c ? num(c.v, c.float ? "f64" : "i32") : e.name;
      }
      case "un": {
        if (e.op === "!") return paren(`${test(e)} ? 1 : 0`);
        const t = typeOf(e.e), ty = t.flex ? (want ?? "i32") : t.ty, inner = value(e.e, ty);
        if (e.op === "-") return ty === "f64" ? paren(`-${inner}`) : paren(`(-${inner}) | 0`);
        return paren(`~${inner}`);
      }
      case "cond": {
        const t = typeOf(e), ty = t.flex ? (want ?? "i32") : t.ty;
        return paren(`${test(e.c)} ? ${value(e.a, ty)} : ${value(e.b, ty)}`);
      }
      case "bin": return binary(e, want);
      case "idx": return `${e.arr}[${value(e.i, "i32")}]!`;
      case "call": return call(e);
    }
  };
  /** `e` as a JavaScript boolean: true when the wasm routine's i32 value is nonzero. */
  const test = (e) => {
    if (e.k === "bin" && CMP.includes(e.op)) {
      const lt = typeOf(e.l), rt = typeOf(e.r);
      const ty = lt.flex && rt.flex ? "i32" : (lt.flex ? rt.ty : lt.ty);
      const jsOp = e.op === "==" ? "===" : e.op === "!=" ? "!==" : e.op;
      return paren(`${value(e.l, ty)} ${jsOp} ${value(e.r, ty)}`);
    }
    if (e.k === "bin" && (e.op === "&&" || e.op === "||")) return paren(`${test(e.l)} ${e.op} ${test(e.r)}`);
    if (e.k === "un" && e.op === "!") return paren(`!${test(e.e)}`);
    if (e.k === "call" && (e.name === "ltu" || e.name === "geu"))
      return paren(`${value(e.args[0], "i32")} >>> 0 ${e.name === "ltu" ? "<" : ">="} ${value(e.args[1], "i32")} >>> 0`);
    if (e.k === "num") return e.v !== 0 ? "(true)" : "(false)";
    return paren(`${value(e, "i32")} !== 0`);
  };
  const binary = (e, want) => {
    const op = e.op;
    if (op === "&&" || op === "||") return paren(`${test(e)} ? 1 : 0`);
    const lt = typeOf(e.l), rt = typeOf(e.r);
    if (op === "<<" || op === ">>") return paren(`${value(e.l, "i32")} ${op} ${value(e.r, "i32")}`);
    if (op === ">>>") return paren(`(${value(e.l, "i32")} >>> ${value(e.r, "i32")}) | 0`);
    const ty = lt.flex && rt.flex ? (want === "f64" && !CMP.includes(op) ? "f64" : "i32") : (lt.flex ? rt.ty : lt.ty);
    const l = value(e.l, ty), r = value(e.r, ty);
    const jsOp = op === "==" ? "===" : op === "!=" ? "!==" : op;
    if (CMP.includes(op)) return paren(`${test(e)} ? 1 : 0`);
    if (ty === "f64") return paren(`${l} ${op} ${r}`);
    if (op === "*") return `Math.imul(${l}, ${r})`;
    if (op === "+" || op === "-") return paren(`(${l} ${op} ${r}) | 0`);
    if (op === "&" || op === "|" || op === "^") return paren(`${l} ${op} ${r}`);
    throw new Error(`operator ${op} on ${ty}`);
  };
  const call = (e) => {
    const a = (i, ty) => value(e.args[i], ty);
    switch (e.name) {
      case "fabs": return `Math.abs(${a(0, "f64")})`;
      case "sqrt": return `Math.sqrt(${a(0, "f64")})`;
      case "floor": return `Math.floor(${a(0, "f64")})`;
      case "copysign": return `copysign_(${a(0, "f64")}, ${a(1, "f64")})`;
      case "hi": return `__hi(${a(0, "f64")})`;
      case "lo": return `__lo(${a(0, "f64")})`;
      case "mk": return `__mk(${a(0, "i32")}, ${a(1, "i32")})`;
      case "setHi": return `__mk(${a(1, "i32")}, __lo(${a(0, "f64")}))`;
      case "setLo": return `__mk(__hi(${a(0, "f64")}), ${a(1, "i32")})`;
      case "toI": return `toI_(${a(0, "f64")})`;
      case "toF": return a(0, "i32");
      case "idiv": return paren(`Math.trunc(${a(0, "i32")} / ${a(1, "i32")}) | 0`);
      case "irem": return paren(`(${a(0, "i32")} % ${a(1, "i32")}) | 0`);
      case "ltu": case "geu": return paren(`${test(e)} ? 1 : 0`);
      case "newF": return `new Float64Array(${a(0, "i32")})`;
      case "newI": return `new Int32Array(${a(0, "i32")})`;
    }
    const g = program.functions.get(e.name);
    return `${fnName(e.name)}(${g.params.map((q, i) => value(e.args[i], q.ty)).join(", ")})`;
  };
  const tsType = (ty) => (ty === "f64[]" ? "Float64Array" : ty === "i32[]" ? "Int32Array" : "number");
  const zero = (ty) => (ty === "f64[]" ? "new Float64Array(0)" : ty === "i32[]" ? "new Int32Array(0)" : "0");
  const target = (t) => (t.k === "id" ? t.name : `${t.arr}[${value(t.i, "i32")}]`);
  const targetTy = (t) => (t.k === "id" ? (locals.get(t.name) ?? program.globals.get(t.name)?.ty) : arrayTy(t.arr) === "f64[]" ? "f64" : "i32");
  const lines = [];
  const stmt = (s, ind) => {
    const p = "  ".repeat(ind);
    switch (s.k) {
      case "block": lines.push(`${p}{`); s.body.forEach((x) => stmt(x, ind + 1)); lines.push(`${p}}`); return;
      case "let": locals.set(s.name, s.ty); lines.push(`${p}let ${s.name}: ${tsType(s.ty)} = ${s.init ? value(s.init, s.ty) : zero(s.ty)};`); return;
      case "const": {
        const e = s.value.k === "num" ? s.value : { ...s.value.e, v: -s.value.e.v };
        consts.set(s.name, { v: e.v, float: e.float });
        return;
      }
      case "assign": {
        const op = s.op.slice(0, -1);
        lines.push(`${p}${target(s.target)} = ${value(op === "" ? s.e : { k: "bin", op, l: s.target, r: s.e }, targetTy(s.target))};`);
        return;
      }
      case "incr": {
        const t = target(s.target), d = s.delta;
        lines.push(targetTy(s.target) === "f64" ? `${p}${t} = ${t} + ${d};` : `${p}${t} = (${t} + ${d}) | 0;`);
        return;
      }
      case "if":
        lines.push(`${p}if ${test(s.c)} {`); stmt(s.then, ind + 1);
        if (s.else) { lines.push(`${p}} else {`); stmt(s.else, ind + 1); }
        lines.push(`${p}}`); return;
      case "return": lines.push(s.e ? `${p}return ${value(s.e, f.ret)};` : `${p}return;`); return;
      case "expr": lines.push(`${p}${value(s.e)};`); return;
      case "break": lines.push(`${p}break;`); return;
      case "continue": lines.push(`${p}continue;`); return;
      case "while": lines.push(`${p}while ${test(s.c)} {`); stmt(s.body, ind + 1); lines.push(`${p}}`); return;
      case "for": {
        // The initializer is a statement of the enclosing scope (a let or an assignment).
        if (s.init) stmt(s.init, ind);
        const stepLines = [];
        if (s.step) { const at = lines.length; stmt(s.step, 0); stepLines.push(...lines.splice(at).map((l) => l.trim().replace(/;$/, ""))); }
        lines.push(`${p}for (; ${s.c ? test(s.c) : ""}; ${stepLines.join(", ")}) {`);
        stmt(s.body, ind + 1);
        lines.push(`${p}}`);
        return;
      }
    }
  };
  for (const s of f.body) stmt(s, 1);
  const exported = FDLIBM_MATH.includes(f.name);
  const params = f.params.map((q) => `${q.name}: ${tsType(q.ty)}`).join(", ");
  return [`function ${fnName(f.name)}(${params}): ${tsType(f.ret)} {`, ...lines, "}", ...(exported ? [] : [])].join("\n");
}
/** Internal names: the exported functions wrap them (NaN canonical at the boundary). */
const fnName = (n) => (FDLIBM_MATH.includes(n) ? `${n}_` : n);

const out = [];
out.push(`/* @scriptc-intrinsics math/1 */
/* Deterministic math: the transcendental functions as one port computes them
 * on every target. Generated by scripts/gen-intrinsics-math.mjs from the
 * WasmGC backend's in-module math library (V8's fdlibm, src/base/ieee754.cc,
 * in packages/compiler/src/backend/wasmgc/fdlibm-source.ts); do not edit.
 *
 * Under Node, tests and unbundled builds the bodies below run as written:
 * plain IEEE double arithmetic, int32 operations kept exact, and the words of
 * a double read and written through a shared Float64Array. When scriptc
 * compiles a program that imports this module (recognised by the pragma on
 * its first line), WasmGC calls its in-module routines, which are built from
 * the same source, and native code compiles these bodies with the word
 * operations as bit casts. LLVM never fuses a multiply and an add unless an
 * instruction asks for it, so no target contracts. Every result is the same
 * double on every target and engine, including pow, which here is fdlibm's
 * front end with a double-double exponential (correctly rounded in all but
 * about 2 results in 10000) rather than the platform's pow.
 *
 * NaN results are the canonical quiet NaN (0x7ff8000000000000).
 *
 * The fdlibm source carries this notice:
 *   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *   Developed at SunSoft, a Sun Microsystems, Inc. business. Permission to
 *   use, copy, modify, and distribute this software is freely granted,
 *   provided that this notice is preserved.
 * and V8's changes: Copyright 2016 the V8 project authors, BSD-3-Clause. */

/* The words of a double (little-endian hosts store the high word second). */
const WORDS = new Float64Array(1);
const HALVES = new Int32Array(WORDS.buffer);
const HI = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 1 : 0;
const LO = 1 - HI;
function __hi(x: number): number { WORDS[0] = x; return HALVES[HI]!; }
function __lo(x: number): number { WORDS[0] = x; return HALVES[LO]!; }
function __mk(h: number, l: number): number { HALVES[HI] = h; HALVES[LO] = l; return WORDS[0]!; }
function copysign_(x: number, y: number): number { return __mk((__hi(x) & 0x7fffffff) | (__hi(y) & -0x80000000), __lo(x)); }
/* C's double-to-int cast as wasm's i32.trunc_sat_f64_s. */
function toI_(x: number): number { return x !== x ? 0 : x >= 2147483647 ? 2147483647 : x <= -2147483648 ? -2147483648 : Math.trunc(x) | 0; }
const canonical = (x: number): number => (x !== x ? NaN : x);
`);
for (const [name, c] of program.consts) out.push(`const ${name} = ${num(c.v, c.float ? "f64" : "i32")};`);
for (const [name, t] of program.tables) out.push(`const ${name} = new ${t.ty === "f64[]" ? "Float64Array" : "Int32Array"}([${t.values.map((v) => num(v, t.ty === "f64[]" ? "f64" : "i32")).join(", ")}]);`);
for (const [name, g] of program.globals) out.push(`let ${name} = ${num(g.init, g.ty)};`);
out.push("");
for (const f of program.functions.values()) out.push(translateFunction(f), "");
for (const n of FDLIBM_MATH) {
  const f = program.functions.get(n);
  const ps = f.params.map((q) => q.name);
  out.push(`/** Math.${n} as the port computes it: the same double on every target. */`);
  out.push(`export function ${n}(${ps.map((p) => `${p}: number`).join(", ")}): number { return canonical(${n}_(${ps.map((p) => `+${p}`).join(", ")})); }`);
}
out.push(`
/* IEEE operations that are exact on every target already, for code that wants one import. */
export const sqrt: (x: number) => number = Math.sqrt;
export const abs: (x: number) => number = Math.abs;
export const floor: (x: number) => number = Math.floor;
export const ceil: (x: number) => number = Math.ceil;
export const trunc: (x: number) => number = Math.trunc;
export const fround: (x: number) => number = Math.fround;
/** a * b + c with two roundings (never fused). */
export function mulAdd(a: number, b: number, c: number): number { return a * b + c; }
/** x with a NaN replaced by the canonical quiet NaN, for values about to be stored as bits. */
export function canonicalNaN(x: number): number { return canonical(x); }
`);
const text = out.join("\n");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== text) { console.error(`${target} is stale: run node scripts/gen-intrinsics-math.mjs`); process.exit(1); }
} else writeFileSync(target, text);
