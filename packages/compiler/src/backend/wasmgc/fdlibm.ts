/* The Math transcendentals compiled into the module (the in-module math library): V8's fdlibm (src/base/ieee754.cc),
 * written in a small typed subset of TypeScript (fdlibm-source.ts) and translated here to Binaryen, one internal
 * function per routine, only those a program reaches. No import is involved: the routines are plain Wasm arithmetic,
 * so they give the same bits on every host.
 *
 * The subset: f64 and i32 values (annotated), f64[] and i32[] arrays (zero-filled by newF/newI; tables are immutable
 * globals), functions, `let` / `const` scalars, if / while / for / break / continue / return, the C operators on both
 * types (integer `/` and `%` through idiv / irem), and the intrinsics below. An integer literal takes the type of the
 * operand beside it. */
import binaryen from "binaryen";

export type FdTy = "f64" | "i32" | "f64[]" | "i32[]";

export type FdExpr =
  | { k: "num"; v: number; float: boolean }
  | { k: "id"; name: string }
  | { k: "bin"; op: string; l: FdExpr; r: FdExpr }
  | { k: "un"; op: "-" | "!" | "~"; e: FdExpr }
  | { k: "cond"; c: FdExpr; a: FdExpr; b: FdExpr }
  | { k: "call"; name: string; args: FdExpr[] }
  | { k: "idx"; arr: string; i: FdExpr };
export type FdStmt =
  | { k: "let"; name: string; ty: FdTy; init?: FdExpr }
  | { k: "const"; name: string; value: FdExpr }
  | { k: "assign"; target: FdExpr; op: string; e: FdExpr }
  | { k: "incr"; target: FdExpr; delta: 1 | -1 }
  | { k: "if"; c: FdExpr; then: FdStmt; else?: FdStmt }
  | { k: "while"; c: FdExpr; body: FdStmt }
  | { k: "for"; init?: FdStmt; c?: FdExpr; step?: FdStmt; body: FdStmt }
  | { k: "return"; e?: FdExpr }
  | { k: "break" }
  | { k: "continue" }
  | { k: "block"; body: FdStmt[] }
  | { k: "expr"; e: FdExpr };
export interface FdFunction { name: string; params: { name: string; ty: FdTy }[]; ret: FdTy; body: FdStmt[] }
export interface FdProgram {
  consts: Map<string, { v: number; float: boolean }>;
  tables: Map<string, { ty: "f64[]" | "i32[]"; values: number[] }>;
  globals: Map<string, { ty: "f64" | "i32"; init: number }>;
  functions: Map<string, FdFunction>;
}

/* ---- lexing and parsing ---- */

const PUNCT = [">>>=", "<<=", ">>=", ">>>", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "+=", "-=", "*=", "/=", "|=", "&=", "^=", "++", "--",
  "+", "-", "*", "/", "%", "&", "|", "^", "~", "!", "<", ">", "=", "?", ":", ";", ",", "(", ")", "{", "}", "[", "]"];
interface Tok { t: "num" | "id" | "p" | "eof"; s: string }

const lex = (src: string): Tok[] => {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 2; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    const num = /^(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(src.slice(i, i + 40));
    if (num) { out.push({ t: "num", s: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 64));
    if (id) { out.push({ t: "id", s: id[0] }); i += id[0].length; continue; }
    const p = PUNCT.find(q => src.startsWith(q, i));
    if (!p) throw new Error(`fdlibm source: unexpected character ${JSON.stringify(c)} at ${i}`);
    out.push({ t: "p", s: p }); i += p.length;
  }
  out.push({ t: "eof", s: "" });
  return out;
};

const BINARY_LEVELS: string[][] = [["||"], ["&&"], ["|"], ["^"], ["&"], ["==", "!="], ["<", "<=", ">", ">="], ["<<", ">>", ">>>"], ["+", "-"], ["*", "/", "%"]];

export const parseFdlibm = (src: string): FdProgram => {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p]!;
  const next = () => toks[p++]!;
  const isP = (s: string) => peek().t === "p" && peek().s === s;
  const isId = (s: string) => peek().t === "id" && peek().s === s;
  const eat = (s: string) => { if (!isP(s)) throw new Error(`fdlibm source: expected ${s}, found ${peek().s}`); p++; };
  const ident = () => { const t = next(); if (t.t !== "id") throw new Error(`fdlibm source: expected a name, found ${t.s}`); return t.s; };
  const number = (s: string): { v: number; float: boolean } => /^0[xX]/.test(s) ? { v: Number(s), float: false } : { v: Number(s), float: /[.eE]/.test(s) };

  const type = (): FdTy => {
    const name = ident();
    if (name !== "f64" && name !== "i32") throw new Error(`fdlibm source: unknown type ${name}`);
    if (isP("[")) { p++; eat("]"); return `${name}[]`; }
    return name;
  };

  const primary = (): FdExpr => {
    const t = next();
    if (t.t === "num") return { k: "num", ...number(t.s) };
    if (t.t === "p" && t.s === "(") { const e = expr(); eat(")"); return e; }
    if (t.t === "p" && (t.s === "-" || t.s === "!" || t.s === "~")) return { k: "un", op: t.s, e: primary() };
    if (t.t === "id") {
      if (t.s === "true") return { k: "num", v: 1, float: false };
      if (t.s === "false") return { k: "num", v: 0, float: false };
      if (isP("(")) {
        p++;
        const args: FdExpr[] = [];
        while (!isP(")")) { args.push(expr()); if (isP(",")) p++; }
        p++;
        return { k: "call", name: t.s, args };
      }
      if (isP("[")) { p++; const i = expr(); eat("]"); return { k: "idx", arr: t.s, i }; }
      return { k: "id", name: t.s };
    }
    throw new Error(`fdlibm source: unexpected ${t.s}`);
  };
  const binary = (level: number): FdExpr => {
    if (level === BINARY_LEVELS.length) return primary();
    let l = binary(level + 1);
    while (peek().t === "p" && BINARY_LEVELS[level]!.includes(peek().s)) { const op = next().s; l = { k: "bin", op, l, r: binary(level + 1) }; }
    return l;
  };
  const expr = (): FdExpr => {
    const c = binary(0);
    if (!isP("?")) return c;
    p++;
    const a = expr();
    eat(":");
    return { k: "cond", c, a, b: expr() };
  };

  /** A statement without its terminating `;` (also a `for` header's init and step). */
  const simple = (): FdStmt => {
    if (isId("let")) {
      p++;
      const name = ident();
      eat(":");
      const ty = type();
      return isP("=") ? (p++, { k: "let", name, ty, init: expr() }) : { k: "let", name, ty };
    }
    if (isId("const")) { p++; const name = ident(); eat("="); return { k: "const", name, value: expr() }; }
    const target = primary();
    if (isP("++") || isP("--")) return { k: "incr", target, delta: next().s === "++" ? 1 : -1 };
    if (peek().t === "p" && (peek().s === "=" || /^[-+*/|&^]=$|^<<=$|^>>>?=$/.test(peek().s))) { const op = next().s; return { k: "assign", target, op, e: expr() }; }
    return { k: "expr", e: target };
  };
  const stmt = (): FdStmt => {
    if (isP("{")) return block();
    if (isId("if")) {
      p++; eat("(");
      const c = expr();
      eat(")");
      const then = stmt();
      if (isId("else")) { p++; return { k: "if", c, then, else: stmt() }; }
      return { k: "if", c, then };
    }
    if (isId("while")) { p++; eat("("); const c = expr(); eat(")"); return { k: "while", c, body: stmt() }; }
    if (isId("for")) {
      p++; eat("(");
      const init = isP(";") ? undefined : simple();
      eat(";");
      const c = isP(";") ? undefined : expr();
      eat(";");
      const step = isP(")") ? undefined : simple();
      eat(")");
      return { k: "for", ...(init ? { init } : {}), ...(c ? { c } : {}), ...(step ? { step } : {}), body: stmt() };
    }
    if (isId("return")) { p++; if (isP(";")) { p++; return { k: "return" }; } const e = expr(); eat(";"); return { k: "return", e }; }
    if (isId("break")) { p++; eat(";"); return { k: "break" }; }
    if (isId("continue")) { p++; eat(";"); return { k: "continue" }; }
    const s = simple();
    eat(";");
    return s;
  };
  const block = (): FdStmt => {
    eat("{");
    const body: FdStmt[] = [];
    while (!isP("}")) body.push(stmt());
    p++;
    return { k: "block", body };
  };

  const literal = (e: FdExpr): { v: number; float: boolean } => {
    if (e.k === "num") return { v: e.v, float: e.float };
    if (e.k === "un" && e.op === "-" && e.e.k === "num") return { v: -e.e.v, float: e.e.float };
    throw new Error("fdlibm source: a top-level value must be a number");
  };
  const program: FdProgram = { consts: new Map(), tables: new Map(), globals: new Map(), functions: new Map() };
  while (peek().t !== "eof") {
    if (isId("function")) {
      p++;
      const name = ident();
      eat("(");
      const params: { name: string; ty: FdTy }[] = [];
      while (!isP(")")) { const n = ident(); eat(":"); params.push({ name: n, ty: type() }); if (isP(",")) p++; }
      p++;
      eat(":");
      const ret = type();
      const body = block();
      program.functions.set(name, { name, params, ret, body: (body as { body: FdStmt[] }).body });
    } else if (isId("const") || isId("let")) {
      const mutable = next().s === "let";
      const name = ident();
      let ty: FdTy | undefined;
      if (isP(":")) { p++; ty = type(); }
      eat("=");
      if (isP("[")) {
        p++;
        const values: number[] = [];
        while (!isP("]")) { values.push(literal(expr()).v); if (isP(",")) p++; }
        p++;
        if (ty !== "f64[]" && ty !== "i32[]") throw new Error(`fdlibm source: table ${name} needs an array type`);
        program.tables.set(name, { ty, values });
      } else {
        const lit = literal(expr());
        if (mutable) program.globals.set(name, { ty: ty === "i32" ? "i32" : "f64", init: lit.v });
        else program.consts.set(name, lit);
      }
      eat(";");
    } else throw new Error(`fdlibm source: unexpected ${peek().s} at top level`);
  }
  return program;
};

/* ---- translation ---- */

type Ref = { e: number; ty: FdTy };
interface FnCtx {
  locals: Map<string, { idx: number; ty: FdTy }>;
  localTypes: number[];
  consts: Map<string, { v: number; float: boolean }>;
  ret: FdTy;
  loops: { brk: string; cont: string }[];
}

/** The routines a program may reach, by Math name. */
export const FDLIBM_MATH = ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "expm1", "log", "log1p", "log2", "log10", "pow",
  "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "cbrt"] as const;

export interface FdlibmHost {
  m: binaryen.Module;
  /** Defines a module-level helper once under its name (the emitter's defineHelper). */
  defineHelper: (name: string, define: () => void) => string;
  /** The source text, parsed once per process. */
  program: FdProgram;
}

/** The compiled routine for `fn` (a Math name), defining it and what it calls on first use. */
export const fdlibmRoutine = (host: FdlibmHost, fn: string): string => new FdlibmEmitter(host).routine(fn);

const emitters = new WeakMap<binaryen.Module, FdlibmEmitter>();
export const fdlibmFor = (host: FdlibmHost): FdlibmEmitter => {
  let e = emitters.get(host.m);
  if (!e) { e = new FdlibmEmitter(host); emitters.set(host.m, e); }
  return e;
};

class FdlibmEmitter {
  private arrayHeaps: { f64: number; i32: number } | undefined;
  private readonly m: binaryen.Module;
  private labels = 0;
  constructor(private readonly host: FdlibmHost) { this.m = host.m; }

  private heaps(): { f64: number; i32: number } {
    if (!this.arrayHeaps) {
      const b = new binaryen.TypeBuilder(2);
      b.setArrayType(0, binaryen.f64, binaryen.notPacked, true);
      b.setArrayType(1, binaryen.i32, binaryen.notPacked, true);
      const [f64, i32] = b.buildAndDispose();
      this.arrayHeaps = { f64: f64!, i32: i32! };
    }
    return this.arrayHeaps;
  }
  private wasmType(ty: FdTy, nonNull = false): number {
    switch (ty) {
      case "f64": return binaryen.f64;
      case "i32": return binaryen.i32;
      case "f64[]": return binaryen.getTypeFromHeapType(this.heaps().f64, !nonNull);
      case "i32[]": return binaryen.getTypeFromHeapType(this.heaps().i32, !nonNull);
    }
  }
  private scalar(ty: FdTy): "f64" | "i32" {
    if (ty !== "f64" && ty !== "i32") throw new Error(`fdlibm source: expected a number, found ${ty}`);
    return ty;
  }

  /** The internal function implementing Math.<fn>. */
  routine(fn: string): string { return this.fn(fn); }

  private fn(name: string): string {
    const f = this.host.program.functions.get(name);
    if (!f) throw new Error(`fdlibm source: no function ${name}`);
    const internal = `$fdlibm.${name}`;
    return this.host.defineHelper(internal, () => {
      const m = this.m;
      const ctx: FnCtx = { locals: new Map(), localTypes: [], consts: new Map(), ret: f.ret, loops: [] };
      const paramTypes: number[] = [];
      f.params.forEach((q, idx) => { ctx.locals.set(q.name, { idx, ty: q.ty }); paramTypes.push(this.wasmType(q.ty)); });
      const body = f.body.map(s => this.stmt(s, ctx));
      const retType = this.wasmType(f.ret);
      m.addFunction(internal, binaryen.createType(paramTypes), retType, ctx.localTypes, m.block(null, [...body, m.unreachable()], binaryen.none));
    });
  }

  private global(name: string, ty: "f64" | "i32", init: number): string {
    const internal = `$fdlibm.${name}`;
    return this.host.defineHelper(internal, () => {
      this.m.addGlobal(internal, ty === "f64" ? binaryen.f64 : binaryen.i32, true, ty === "f64" ? this.m.f64.const(init) : this.m.i32.const(init | 0));
    });
  }

  private table(name: string): { global: string; ty: "f64[]" | "i32[]" } {
    const t = this.host.program.tables.get(name)!;
    const internal = `$fdlibm.${name}`;
    this.host.defineHelper(internal, () => {
      const m = this.m, heap = t.ty === "f64[]" ? this.heaps().f64 : this.heaps().i32;
      m.addGlobal(internal, this.wasmType(t.ty, true), false, m.array.new_fixed(heap, t.values.map(v => t.ty === "f64[]" ? m.f64.const(v) : m.i32.const(v | 0))));
    });
    return { global: internal, ty: t.ty };
  }

  /** The type an expression takes, and whether it is an integer literal (so it can take its neighbour's type). */
  private typeOf(e: FdExpr, ctx: FnCtx): { ty: FdTy; flex: boolean } {
    switch (e.k) {
      case "num": return { ty: e.float ? "f64" : "i32", flex: !e.float };
      case "id": {
        const l = ctx.locals.get(e.name);
        if (l) return { ty: l.ty, flex: false };
        const c = ctx.consts.get(e.name) ?? this.host.program.consts.get(e.name);
        if (c) return { ty: c.float ? "f64" : "i32", flex: false };
        const g = this.host.program.globals.get(e.name);
        if (g) return { ty: g.ty, flex: false };
        if (this.host.program.tables.has(e.name)) return { ty: this.host.program.tables.get(e.name)!.ty, flex: false };
        throw new Error(`fdlibm source: unknown name ${e.name}`);
      }
      case "un": { const t = this.typeOf(e.e, ctx); return e.op === "!" ? { ty: "i32", flex: false } : t; }
      case "bin": {
        if (["==", "!=", "<", "<=", ">", ">=", "&&", "||"].includes(e.op)) return { ty: "i32", flex: false };
        const l = this.typeOf(e.l, ctx), r = this.typeOf(e.r, ctx);
        if (["<<", ">>", ">>>"].includes(e.op)) return { ty: l.ty, flex: l.flex && r.flex };
        if (l.flex && r.flex) return { ty: "i32", flex: true };
        return { ty: l.flex ? r.ty : l.ty, flex: false };
      }
      case "cond": {
        const a = this.typeOf(e.a, ctx), b = this.typeOf(e.b, ctx);
        return a.flex && b.flex ? { ty: "i32", flex: true } : { ty: a.flex ? b.ty : a.ty, flex: false };
      }
      case "idx": return { ty: this.arrayTy(e.arr, ctx) === "f64[]" ? "f64" : "i32", flex: false };
      case "call": return { ty: this.callTy(e, ctx), flex: false };
    }
  }
  private arrayTy(name: string, ctx: FnCtx): "f64[]" | "i32[]" {
    const t = ctx.locals.get(name)?.ty ?? this.host.program.tables.get(name)?.ty;
    if (t !== "f64[]" && t !== "i32[]") throw new Error(`fdlibm source: ${name} is not an array`);
    return t;
  }

  private static readonly F64_UNARY = new Set(["fabs", "sqrt", "floor"]);
  private callTy(e: Extract<FdExpr, { k: "call" }>, ctx: FnCtx): FdTy {
    const n = e.name;
    if (FdlibmEmitter.F64_UNARY.has(n) || n === "copysign" || n === "mk" || n === "setHi" || n === "setLo" || n === "toF") return "f64";
    if (n === "hi" || n === "lo" || n === "toI" || n === "idiv" || n === "irem" || n === "ltu" || n === "geu") return "i32";
    if (n === "newF") return "f64[]";
    if (n === "newI") return "i32[]";
    const f = this.host.program.functions.get(n);
    if (!f) throw new Error(`fdlibm source: unknown function ${n}`);
    void ctx;
    return f.ret;
  }

  /** `e` as a value of type `want` (an integer literal becomes the number it names in that type). */
  private value(e: FdExpr, ctx: FnCtx, want?: FdTy): Ref {
    const m = this.m;
    switch (e.k) {
      case "num": {
        const ty = want === "f64" || e.float ? "f64" : "i32";
        return ty === "f64" ? { e: m.f64.const(e.v), ty } : { e: m.i32.const(e.v | 0), ty };
      }
      case "id": {
        const l = ctx.locals.get(e.name);
        if (l) return { e: m.local.get(l.idx, this.wasmType(l.ty)), ty: l.ty };
        const c = ctx.consts.get(e.name) ?? this.host.program.consts.get(e.name);
        if (c) return this.value({ k: "num", v: c.v, float: c.float }, ctx, c.float ? "f64" : "i32");
        const g = this.host.program.globals.get(e.name);
        if (g) { const name = this.global(e.name, g.ty, g.init); return { e: m.global.get(name, g.ty === "f64" ? binaryen.f64 : binaryen.i32), ty: g.ty }; }
        throw new Error(`fdlibm source: unknown name ${e.name}`);
      }
      case "un": {
        if (e.op === "!") return { e: m.i32.eqz(this.value(e.e, ctx, "i32").e), ty: "i32" };
        const t = this.typeOf(e.e, ctx);
        const inner = this.value(e.e, ctx, t.flex ? want : t.ty);
        if (e.op === "-") return inner.ty === "f64" ? { e: m.f64.neg(inner.e), ty: "f64" } : { e: m.i32.sub(m.i32.const(0), inner.e), ty: "i32" };
        return { e: m.i32.xor(inner.e, m.i32.const(-1)), ty: "i32" };
      }
      case "cond": {
        const t = this.typeOf(e, ctx), ty = t.flex ? (want ?? "i32") : t.ty;
        return { e: m.if(this.value(e.c, ctx, "i32").e, this.value(e.a, ctx, ty).e, this.value(e.b, ctx, ty).e), ty: this.scalar(ty) };
      }
      case "bin": return this.binary(e, ctx, want);
      case "idx": {
        const aty = this.arrayTy(e.arr, ctx), elem = aty === "f64[]" ? "f64" : "i32";
        return { e: m.array.get(this.arrayRef(e.arr, ctx), this.value(e.i, ctx, "i32").e, elem === "f64" ? binaryen.f64 : binaryen.i32, false), ty: elem };
      }
      case "call": return this.call(e, ctx);
    }
  }
  private arrayRef(name: string, ctx: FnCtx): number {
    const l = ctx.locals.get(name);
    if (l) return this.m.local.get(l.idx, this.wasmType(l.ty));
    const t = this.table(name);
    return this.m.global.get(t.global, this.wasmType(t.ty, true));
  }

  private binary(e: Extract<FdExpr, { k: "bin" }>, ctx: FnCtx, want: FdTy | undefined): Ref {
    const m = this.m, op = e.op;
    if (op === "&&" || op === "||") {
      const l = this.value(e.l, ctx, "i32").e, r = this.value(e.r, ctx, "i32").e;
      return op === "&&" ? { e: m.if(l, m.i32.ne(r, m.i32.const(0)), m.i32.const(0)), ty: "i32" } : { e: m.if(l, m.i32.const(1), m.i32.ne(r, m.i32.const(0))), ty: "i32" };
    }
    const lt = this.typeOf(e.l, ctx), rt = this.typeOf(e.r, ctx);
    if (op === "<<" || op === ">>" || op === ">>>") {
      const l = this.value(e.l, ctx, "i32"), r = this.value(e.r, ctx, "i32");
      if (l.ty !== "i32") throw new Error("fdlibm source: a shift needs integers");
      return { e: (op === "<<" ? m.i32.shl : op === ">>" ? m.i32.shr_s : m.i32.shr_u)(l.e, r.e), ty: "i32" };
    }
    const ty: "f64" | "i32" = lt.flex && rt.flex ? (want === "f64" && !["==", "!=", "<", "<=", ">", ">="].includes(op) ? "f64" : "i32") : this.scalar(lt.flex ? rt.ty : lt.ty);
    const l = this.value(e.l, ctx, ty), r = this.value(e.r, ctx, ty);
    if (l.ty !== r.ty) throw new Error(`fdlibm source: ${op} mixes ${l.ty} and ${r.ty}`);
    if (ty === "f64") {
      const F = m.f64;
      switch (op) {
        case "+": return { e: F.add(l.e, r.e), ty };
        case "-": return { e: F.sub(l.e, r.e), ty };
        case "*": return { e: F.mul(l.e, r.e), ty };
        case "/": return { e: F.div(l.e, r.e), ty };
        case "==": return { e: F.eq(l.e, r.e), ty: "i32" };
        case "!=": return { e: F.ne(l.e, r.e), ty: "i32" };
        case "<": return { e: F.lt(l.e, r.e), ty: "i32" };
        case "<=": return { e: F.le(l.e, r.e), ty: "i32" };
        case ">": return { e: F.gt(l.e, r.e), ty: "i32" };
        case ">=": return { e: F.ge(l.e, r.e), ty: "i32" };
      }
    } else {
      const I = m.i32;
      switch (op) {
        case "+": return { e: I.add(l.e, r.e), ty };
        case "-": return { e: I.sub(l.e, r.e), ty };
        case "*": return { e: I.mul(l.e, r.e), ty };
        case "&": return { e: I.and(l.e, r.e), ty };
        case "|": return { e: I.or(l.e, r.e), ty };
        case "^": return { e: I.xor(l.e, r.e), ty };
        case "==": return { e: I.eq(l.e, r.e), ty };
        case "!=": return { e: I.ne(l.e, r.e), ty };
        case "<": return { e: I.lt_s(l.e, r.e), ty };
        case "<=": return { e: I.le_s(l.e, r.e), ty };
        case ">": return { e: I.gt_s(l.e, r.e), ty };
        case ">=": return { e: I.ge_s(l.e, r.e), ty };
      }
    }
    throw new Error(`fdlibm source: operator ${op} on ${ty}`);
  }

  private call(e: Extract<FdExpr, { k: "call" }>, ctx: FnCtx): Ref {
    const m = this.m, a = (i: number, ty: FdTy) => this.value(e.args[i]!, ctx, ty).e;
    const bits = (x: number) => m.i64.reinterpret(x);
    const k32 = m.i64.const(32n as unknown as number);
    const hi = (x: number) => m.i32.wrap(m.i64.shr_u(bits(x), k32));
    const lo = (x: number) => m.i32.wrap(bits(x));
    const make = (h: number, l: number) => m.f64.reinterpret(m.i64.or(m.i64.shl(m.i64.extend_u(h), k32), m.i64.extend_u(l)));
    switch (e.name) {
      case "fabs": return { e: m.f64.abs(a(0, "f64")), ty: "f64" };
      case "sqrt": return { e: m.f64.sqrt(a(0, "f64")), ty: "f64" };
      case "floor": return { e: m.f64.floor(a(0, "f64")), ty: "f64" };
      case "copysign": return { e: m.f64.copysign(a(0, "f64"), a(1, "f64")), ty: "f64" };
      case "hi": return { e: hi(a(0, "f64")), ty: "i32" };
      case "lo": return { e: lo(a(0, "f64")), ty: "i32" };
      case "mk": return { e: make(a(0, "i32"), a(1, "i32")), ty: "f64" };
      case "setHi": return { e: make(a(1, "i32"), lo(a(0, "f64"))), ty: "f64" };
      case "setLo": return { e: make(hi(a(0, "f64")), a(1, "i32")), ty: "f64" };
      case "toI": return { e: m.i32.trunc_s_sat.f64(a(0, "f64")), ty: "i32" };
      case "toF": return { e: m.f64.convert_s.i32(a(0, "i32")), ty: "f64" };
      case "idiv": return { e: m.i32.div_s(a(0, "i32"), a(1, "i32")), ty: "i32" };
      case "irem": return { e: m.i32.rem_s(a(0, "i32"), a(1, "i32")), ty: "i32" };
      case "ltu": return { e: m.i32.lt_u(a(0, "i32"), a(1, "i32")), ty: "i32" };
      case "geu": return { e: m.i32.ge_u(a(0, "i32"), a(1, "i32")), ty: "i32" };
      case "newF": return { e: m.array.new_default(this.heaps().f64, a(0, "i32")), ty: "f64[]" };
      case "newI": return { e: m.array.new_default(this.heaps().i32, a(0, "i32")), ty: "i32[]" };
    }
    const f = this.host.program.functions.get(e.name);
    if (!f) throw new Error(`fdlibm source: unknown function ${e.name}`);
    const name = this.fn(e.name);
    return { e: m.call(name, f.params.map((q, i) => this.value(e.args[i]!, ctx, q.ty).e), this.wasmType(f.ret)), ty: f.ret };
  }

  private declare(ctx: FnCtx, name: string, ty: FdTy): number {
    if (ctx.locals.has(name)) throw new Error(`fdlibm source: ${name} is declared twice`);
    const idx = [...ctx.locals.values()].length;
    ctx.locals.set(name, { idx, ty });
    ctx.localTypes.push(this.wasmType(ty));
    return idx;
  }
  private zero(ty: FdTy): number {
    const m = this.m;
    return ty === "f64" ? m.f64.const(0) : ty === "i32" ? m.i32.const(0) : m.ref.null(this.wasmType(ty));
  }

  private assignTo(target: FdExpr, rhs: (cur: Ref, want: FdTy) => Ref, ctx: FnCtx): number {
    const m = this.m;
    if (target.k === "id") {
      const l = ctx.locals.get(target.name);
      if (l) { const cur = this.value(target, ctx); return m.local.set(l.idx, rhs(cur, l.ty).e); }
      const g = this.host.program.globals.get(target.name);
      if (g) { const name = this.global(target.name, g.ty, g.init); return m.global.set(name, rhs(this.value(target, ctx), g.ty).e); }
      throw new Error(`fdlibm source: cannot assign ${target.name}`);
    }
    if (target.k === "idx") {
      const aty = this.arrayTy(target.arr, ctx), elem = aty === "f64[]" ? "f64" : "i32";
      return m.array.set(this.arrayRef(target.arr, ctx), this.value(target.i, ctx, "i32").e, rhs(this.value(target, ctx), elem).e);
    }
    throw new Error("fdlibm source: bad assignment target");
  }

  private stmt(s: FdStmt, ctx: FnCtx): number {
    const m = this.m;
    switch (s.k) {
      case "block": return m.block(null, s.body.map(x => this.stmt(x, ctx)), binaryen.none);
      case "let": {
        const idx = this.declare(ctx, s.name, s.ty);
        return m.local.set(idx, s.init ? this.value(s.init, ctx, s.ty).e : this.zero(s.ty));
      }
      case "const": {
        const e = s.value.k === "num" ? s.value : s.value.k === "un" && s.value.op === "-" && s.value.e.k === "num" ? { ...s.value.e, v: -s.value.e.v } : undefined;
        if (!e) throw new Error(`fdlibm source: const ${s.name} must be a number`);
        ctx.consts.set(s.name, { v: e.v, float: e.float });
        return m.nop();
      }
      case "assign": {
        const op = s.op.slice(0, -1);
        return this.assignTo(s.target, (_cur, want) => this.value(op === "" ? s.e : { k: "bin", op, l: s.target, r: s.e }, ctx, want), ctx);
      }
      case "incr": return this.assignTo(s.target, (cur) => ({ e: cur.ty === "f64" ? m.f64.add(cur.e, m.f64.const(s.delta)) : m.i32.add(cur.e, m.i32.const(s.delta)), ty: cur.ty }), ctx);
      case "if": return m.if(this.value(s.c, ctx, "i32").e, this.stmt(s.then, ctx), s.else ? this.stmt(s.else, ctx) : undefined);
      case "return": return s.e ? m.return(this.value(s.e, ctx, ctx.ret).e) : m.return();
      case "expr": { const r = this.value(s.e, ctx); return m.drop(r.e); }
      case "break": return m.br(ctx.loops[ctx.loops.length - 1]!.brk);
      case "continue": return m.br(ctx.loops[ctx.loops.length - 1]!.cont);
      case "while": {
        const id = this.labels++, brk = `fb${id}`, top = `ft${id}`;
        ctx.loops.push({ brk, cont: top });
        const body = this.stmt(s.body, ctx);
        ctx.loops.pop();
        return m.block(brk, [m.loop(top, m.block(null, [m.br(brk, m.i32.eqz(this.value(s.c, ctx, "i32").e)), body, m.br(top)], binaryen.none))], binaryen.none);
      }
      case "for": {
        const id = this.labels++, brk = `fb${id}`, top = `ft${id}`, cont = `fc${id}`;
        const init = s.init ? this.stmt(s.init, ctx) : m.nop();
        ctx.loops.push({ brk, cont });
        const body = this.stmt(s.body, ctx);
        ctx.loops.pop();
        const step = s.step ? this.stmt(s.step, ctx) : m.nop();
        const test = s.c ? [m.br(brk, m.i32.eqz(this.value(s.c, ctx, "i32").e))] : [];
        return m.block(null, [init, m.block(brk, [m.loop(top, m.block(null, [...test, m.block(cont, [body], binaryen.none), step, m.br(top)], binaryen.none))], binaryen.none)], binaryen.none);
      }
    }
  }
}
