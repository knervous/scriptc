/* The browser as Scriptc's dynamic island.
 *
 * Under `dynamic`, values typed `any` are `jsval` and operations on them are
 * `jsOp`s that Scriptc's native backend runs in an embedded engine. In the
 * browser the page's own engine is that island: a jsval is an `externref`
 * and each operation is a thin host import (`Reflect.get`, `+`, `new`, ...).
 * This is the generic Phase 2 path: any DOM, fetch or library call works
 * through it; typed WebIDL fast paths can shortcut it later.
 *
 * Variable-arity operations (calls, literals) use per-arity imports named
 * `js.<op>.<n>`; the host synthesises them from the module's import list.
 * Closures marshal to real JS functions through an exported per-signature
 * invoker that checks its arguments exactly like jsExit. */
import binaryen from "binaryen";
import { callCode } from "./types.js";
import { domDirectImport } from "./host.js";
import type { IrExpr, IrType, SrcLoc } from "../../ir/ir.js";

/** Methods whose first argument is structured-cloned by the browser (see host.ts callSink). */
const SINK_METHODS: ReadonlySet<string> = new Set(["postMessage", "pushState", "replaceState"]);

export interface JsBridgeContext {
  m: binaryen.Module;
  expr(e: IrExpr): number;
  host(name: string, params: number[], result: number): string;
  stringConst(value: string): number;
  externConvertAny(value: number): number;
  anyConvertExtern(value: number): number;
  /** experimentalDomMirror: a typed `recv.<method>(...args)` (receiver first) the mirror handles, or null. */
  mirrorJsCall?(method: string, args: number[]): number | null;
  valueType(t: IrType): number;
  typeKey(t: IrType): string;
  /** Typed closure call pieces for invokers. */
  closureInfo(t: IrType & { kind: "func" }): { ref: number; sig: number; params: number[]; result: number };
  /** IR value → JSON text (externref). */
  jsonStringify(value: IrExpr): number;
  /** JSON text (externref) → checked static value of `type`. */
  jsonCheck(text: number, type: IrType): number;
  promiseBridge(): { create: string; settle: string; settleInline: string; ref: number };
  temp(type: number): number;
  /** Throw a compiled TypeError with this message. */
  typeError(message: string): number;
  /** A value fetched once into the named module global (non-null externref). */
  once?(global: string, fetch: () => number): number;
  unsupported(what: string, loc?: SrcLoc): never;
  /** A typed value of this static type is about to reach the page (closure escape analysis). */
  escape?(t: IrType): void;
  /** Memoized bodies the paged-record analysis treats as nodes: `request` on every use, `within` around the one build. */
  request?(node: string): void;
  within?<T>(node: string, build: () => T): T;
  /** dyn values are engine values (browser builds). */
  engineDyn?: boolean;
  browser?: boolean;
  /** Native dyn on the browser target: a dyn value to and from JS. */
  dynToJs?(v: number): number;
  /** dynToJs for a value stored into a page-typed `any`: a compiled ArrayBuffer (raw bytes) throws instead of crossing as a byte view. */
  dynToJsStored?(v: number): number;
  /** A compiled typed value (Map / Set) crossing to the page by reference: register it so page-typed dispatch recognizes it when it comes back. */
  dynRef?(t: IrType): void;
  dynFromJs?(v: number): number;
  /** Browser target: the full JS → compiled exit (page-backed records, typed
   * arrays, adopted promises, facades), used for a page call's arguments. */
  engineExit?(v: number, t: IrType, loc: SrcLoc): number;
  /** Native dyn: the struct type a dyn settle target is (a dyn:str box whose
   * externref field holds the compiled promise): jsSettle delivers the settled
   * value to that promise as dyn (dynFromJs) instead of raw. */
  dynSettleBox?(): number;
  /** A page rejection reason as a caught value (an Error becomes the compiled error). */
  wrapJsError?(value: number): number;
  /** An f64 as a JS value (JS's undefined for the undefined-read NaN). */
  numToJs(v: number): number;
  /** A number from JS: raw bits, so the reserved undefined pattern is canonicalized. */
  numFromJs?(v: number): number;
  /** A compiled promise as a JS promise. */
  promiseToJs(value: number, inner: IrType): number;
  /** Engine dyn: the one closure → JS function route (cached per closure,
   * receiver and actual arguments passed, void returns undefined). */
  fnToJs?(v: number, t: IrType & { kind: "func" }): number;
  /** Engine dyn: an emitted value of any other type as a JS value. */
  valueToJs?(v: number, t: IrType): number;
  withOwnLocals(paramCount: number, build: () => number): { body: number; locals: number[] };
}

const E = binaryen.externref, F = binaryen.f64, I = binaryen.i32;
const BINARY = new Set(["add", "sub", "mul", "div", "mod", "pow"]);
const COMPARE = new Set(["lt", "le", "gt", "ge", "eq", "neq", "instanceOf"]);

export function jsBridge(ctx: JsBridgeContext) {
  const { m } = ctx;
  const imp = (name: string, params: number[], result: number) => ctx.host(name, params, result);
  const call = (name: string, params: number[], result: number, args: number[]) => m.call(imp(name, params, result), args, result);
  const name = (n: string | undefined, loc: SrcLoc) => n !== undefined ? ctx.stringConst(n) : ctx.unsupported("jsOp without a member name", loc);

  /** A compiler-made helper called at once: `new Function(<constant strings>)`
   * (destructuring patterns run by the engine). Its body is constant and runs
   * in the global scope, so one function serves every evaluation: it is built
   * on first use with the page's original Function, not once per call. */
  const helpers = new Map<string, string>();
  const constantHelper = (e: IrExpr): number | null => {
    if (!ctx.once || e.kind !== "jsOp" || e.op !== "construct") return null;
    const [callee, ...rest] = e.args;
    if (callee?.kind !== "jsOp" || callee.op !== "globalGet" || callee.name !== "Function") return null;
    const texts: string[] = [];
    for (const x of rest) { if (x.kind !== "jsMarshal" || x.value.kind !== "strLit") return null; texts.push(x.value.value); }
    const key = JSON.stringify(texts);
    let global = helpers.get(key);
    if (global === undefined) { global = `$jsfn.helper.${helpers.size}`; helpers.set(key, global); }
    const strs = texts.map(t => ctx.stringConst(t));
    return ctx.once(global, () => call(`js.construct.${strs.length}`, Array<number>(strs.length + 1).fill(E), E, [call("js.global", [E], E, [ctx.stringConst("Function")]), ...strs]));
  };
  /** One jsOp. Args are jsval (externref) except the documented shapes. */
  const op = (e: IrExpr & { kind: "jsOp" }): number => {
    const helper = e.op === "callFn" && e.args[0] ? constantHelper(e.args[0]) : null;
    const a = e.args.map((x, i) => i === 0 && helper !== null ? helper : ctx.expr(x)), n = a.length, ps = (k: number) => Array<number>(k).fill(E);
    if (BINARY.has(e.op)) return call(`js.${e.op}`, [E, E], E, a);
    // `x === null` / `x !== null` on a page value: JS null crosses as the null
    // externref (undefined does not), so the strict test is ref.is_null.
    if ((e.op === "eq" || e.op === "neq") && e.args.length === 2) {
      const nullAt = e.args.findIndex((x) => x.kind === "jsOp" && x.op === "nullLit");
      if (nullAt >= 0) {
        const isNull = m.ref.is_null(a[1 - nullAt]!);
        return e.op === "eq" ? isNull : m.i32.eqz(isNull);
      }
    }
    if (COMPARE.has(e.op)) return call(`js.${e.op}`, [E, E], I, a);
    switch (e.op) {
      case "neg": case "plus": return call(`js.${e.op}`, [E], E, a);
      case "truthy": case "not": return call(`js.${e.op}`, [E], I, a);
      case "typeof": return call("js.typeof", [E], E, a);
      case "toStr": {
        // String(n) on a statically numeric value: the typed num.toString member
        // (ECMAScript Number::toString), not the generic engine conversion.
        const arg = e.args[0];
        if (arg?.kind === "jsMarshal" && arg.value.type.kind === "f64") return call("num.toString", [binaryen.f64], E, [ctx.expr(arg.value)]);
        return call("js.toStrOp", [E], E, a);
      }
      // A typed read of one page global (host-ABI §7: js.global.<name>).
      case "globalGet": return call(`js.global.${e.name}`, [], E, []);
      case "undefLit": return call("js.undefined", [], E, []);
      // JS null is the null externref on every host (the browser's null crossing, the native host's None), so wasm
      // makes it itself: no js.null host call.
      case "nullLit": return m.ref.null(E);
      // DOM members (DOM_DIRECT) by name: their own host imports.
      case "getProp": { const dom = e.name !== undefined ? domDirectImport("get", e.name) : null;
        return dom ? call(dom, [E], E, [a[0]!]) : call("js.get", [E, E], E, [a[0]!, name(e.name, e.loc)]); }
      case "setProp": { const dom = e.name !== undefined ? domDirectImport("set", e.name) : null;
        return dom ? call(dom, [E, E], binaryen.none, [a[0]!, a[1]!]) : call("js.set", [E, E, E], binaryen.none, [a[0]!, name(e.name, e.loc), a[1]!]); }
      case "getIdx": return call("js.get", [E, E], E, a);
      case "setIdx": return call("js.set", [E, E, E], binaryen.none, a);
      case "callMethod": { const dom = e.name !== undefined ? domDirectImport("call", e.name, n - 1) : null;
        const mirrored = dom && ctx.mirrorJsCall ? ctx.mirrorJsCall(e.name!, a) : null;
        if (mirrored !== null) return mirrored;
        return dom ? call(dom, ps(n), E, a) : call(`js.${e.name !== undefined && SINK_METHODS.has(e.name) && n >= 2 && n <= 4 ? "sinkMethod" : "callMethod"}.${n - 1}`, ps(n + 1), E, [a[0]!, name(e.name, e.loc), ...a.slice(1)]); }
      // `o.name?.(...)`: the member is read once; a nullish member is undefined and the
      // arguments never run; otherwise it is called with `this` = o.
      case "optCallMethod": {
        const o = ctx.temp(E), f = ctx.temp(E);
        return m.block(null, [m.local.set(o, a[0]!), m.local.set(f, call("js.get", [E, E], E, [m.local.get(o, E), name(e.name, e.loc)])),
          m.if(call("js.isNullish", [E], I, [m.local.get(f, E)]), call("js.undefined", [], E, []),
            e.name !== undefined && SINK_METHODS.has(e.name) && n >= 2 && n <= 4
              ? call(`js.sinkMethod.${n - 1}`, ps(n + 1), E, [m.local.get(o, E), name(e.name, e.loc), ...a.slice(1)])
              : call(`js.callFnThis.${n - 1}`, ps(n + 1), E, [m.local.get(f, E), m.local.get(o, E), ...a.slice(1)]))], E);
      }
      case "callFn": return call(`js.callFn.${n - 1}`, ps(n), E, a);
      case "callFnThis": return call(`js.callFnThis.${n - 2}`, ps(n), E, a);
      case "construct": return call(`js.construct.${n - 1}`, ps(n), E, a);
      case "callSpread": return call("js.callSpread", [E, E, E], E, a);
      case "callMethodSpread": return call("js.callMethodSpread", [E, E, E, E], E, [a[0]!, name(e.name, e.loc), a[1]!, a[2]!]);
      case "objLit": return call(`js.objLit.${n}`, ps(n), E, a);
      case "arrLit": return call(`js.arrLit.${n}`, ps(n), E, a);
      case "defineGetter": return call("js.defineGetter", [E, E, E], E, a);
      case "objSpread": return call("js.assign", [E, E], E, a);
      default: return ctx.unsupported(`island operation ${e.op}`, e.loc);
    }
  };

  /* Static → JS. */
  const marshal = (value: IrExpr, loc: SrcLoc, opaque = false, stored = false): number => {
    const t = value.type;
    ctx.escape?.(t);
    // A compiled reference crossing by reference: class instances, records
    // and arrays as their live page facades (identity kept, readable by the
    // page; a facade unwraps on the way back), anything else the struct itself.
    if (opaque) return (t.kind === "object" || t.kind === "record" || t.kind === "array") && ctx.valueToJs ? ctx.valueToJs(ctx.expr(value), t) : ctx.externConvertAny(ctx.expr(value));
    switch (t.kind) {
      case "f64": return ctx.numToJs(ctx.expr(value));
      case "bool": return call("js.fromBool", [I], E, [ctx.expr(value)]);
      case "string": case "jsval": case "symbol": case "bigint": case "regex": case "date": return ctx.expr(value);
      case "dyn": if (ctx.engineDyn) return ctx.expr(value); if (stored && ctx.dynToJsStored) return ctx.dynToJsStored(ctx.expr(value)); if (ctx.dynToJs) return ctx.dynToJs(ctx.expr(value)); return ctx.unsupported("marshalling dyn to JavaScript", loc);
      case "undefinedT": case "void": { const v = ctx.expr(value); return m.block(null, [binaryen.getExpressionType(v) === binaryen.none ? v : m.drop(v), call("js.undefined", [], E, [])], E); }
      case "nullT": { const v = ctx.expr(value); return m.block(null, [binaryen.getExpressionType(v) === binaryen.none ? v : m.drop(v), m.ref.null(E)], E); }
      case "func": return ctx.fnToJs ? ctx.fnToJs(ctx.expr(value), t) : call("js.fromFn", [E, E], E, [ctx.externConvertAny(ctx.expr(value)), ctx.stringConst(invoker(t))]);
      case "union": if (ctx.valueToJs) return ctx.valueToJs(ctx.expr(value), t); return call("js.parse", [E], E, [ctx.jsonStringify(value)]);
      case "record": case "array": if (ctx.valueToJs) return ctx.valueToJs(ctx.expr(value), t); return call("js.parse", [E], E, [ctx.jsonStringify(value)]);
      case "promise": return ctx.promiseToJs(ctx.expr(value), t.inner);
      case "generator": if (ctx.valueToJs) return ctx.valueToJs(ctx.expr(value), t); return ctx.unsupported("marshalling generator to JavaScript", loc);
      case "bytes": if (ctx.valueToJs) return ctx.valueToJs(ctx.expr(value), t); return ctx.unsupported("marshalling bytes to JavaScript", loc);
      // Engine dyn: compiled instances (caught errors, class objects) cross by reference.
      case "object": case "caught": case "map": case "set": if (t.kind === "map" || t.kind === "set") ctx.dynRef?.(t); if (ctx.browser) return t.kind === "object" && ctx.valueToJs ? ctx.valueToJs(ctx.expr(value), t) : ctx.externConvertAny(ctx.expr(value)); return ctx.unsupported(`marshalling ${t.kind} to JavaScript`, loc);
      default: return ctx.unsupported(`marshalling ${t.kind} to JavaScript`, loc);
    }
  };

  /* JS → static, strict for primitives (no coercion). */
  const exitTo = (v: number, t: IrType, loc: SrcLoc): number => {
    switch (t.kind) {
      case "f64": { const n = call("js.toNum", [E], F, [v]); return ctx.numFromJs ? ctx.numFromJs(n) : n; }
      case "bool": return call("js.toBool", [E], I, [v]);
      case "string": return call("js.toStr", [E], E, [v]);
      case "jsval": case "symbol": case "bigint": return v;
      // A regex is a host value: the host confirms it is one (re.is), else TypeError.
      case "regex": {
        const x = ctx.temp(E);
        return m.block(null, [m.local.set(x, v), m.if(call("re.is", [E], I, [m.local.get(x, E)]), m.local.get(x, E), ctx.typeError("value from JavaScript is not a RegExp"))], E);
      }
      case "dyn": if (ctx.engineDyn) return v; if (ctx.dynFromJs) return ctx.dynFromJs(v); return ctx.unsupported("exiting JavaScript to dyn", loc);
      case "void": return m.drop(v);
      case "record": case "array": case "union": case "map": case "set": return ctx.jsonCheck(call("js.stringify", [E], E, [v]), t);
      default: return ctx.unsupported(`exiting JavaScript to ${t.kind}`, loc);
    }
  };
  const exit = (e: IrExpr & { kind: "jsExit"; opaque?: true }) => e.opaque ? opaqueExit(ctx.expr(e.value), e.type) : exitTo(ctx.expr(e.value), e.type, e.loc);
  /** An opaque reference back to its compiled type: a type test, or a TypeError
   * (a class instance's page facade unwraps to the instance first). */
  const opaqueExit = (v: number, t: IrType): number => {
    const target = ctx.valueType(t), nn = binaryen.getTypeFromHeapType(binaryen.getHeapType(target), false);
    const a = ctx.temp(binaryen.anyref);
    // A compiled promise's page Promise unwraps to the promise like a facade.
    if ((t.kind === "object" || t.kind === "record" || t.kind === "array" || t.kind === "promise") && ctx.browser) {
      const x = ctx.temp(E);
      return m.block(null, [
        m.local.set(x, v), m.local.set(a, ctx.anyConvertExtern(m.local.get(x, E))),
        m.if(m.i32.eqz(m.ref.test(m.local.get(a, binaryen.anyref), nn)), m.local.set(a, ctx.anyConvertExtern(call("js.unwrapFacade", [E], E, [m.local.get(x, E)])))),
        m.if(m.i32.eqz(m.ref.test(m.local.get(a, binaryen.anyref), nn)), ctx.typeError("value from JavaScript is not the expected compiled object")),
        m.ref.cast(m.local.get(a, binaryen.anyref), nn),
      ], nn);
    }
    return m.block(null, [
      m.local.set(a, ctx.anyConvertExtern(v)),
      m.if(m.i32.eqz(m.ref.test(m.local.get(a, binaryen.anyref), nn)), ctx.typeError("value from JavaScript is not the expected compiled object")),
      m.ref.cast(m.local.get(a, binaryen.anyref), nn),
    ], nn);
  };

  /* Closures as JS functions: one exported invoker per signature, named in
   * the host call; it checks each argument like jsExit and marshals the
   * result back. */
  const invokers = new Map<string, string>();
  const invoker = (t: IrType & { kind: "func" }): string => {
    const key = ctx.typeKey(t);
    const node = `$jsinvoke.${key}`;
    ctx.request?.(node);
    const known = invokers.get(key);
    if (known) return known;
    const created = `jsInvoke${invokers.size}`;
    invokers.set(key, created);
    return ctx.within ? ctx.within(node, () => buildInvoker(t, created)) : buildInvoker(t, created);
  };
  const buildInvoker = (t: IrType & { kind: "func" }, exportName: string): string => {
    const info = ctx.closureInfo(t), fnName = `$${exportName}`;
    const params = [E, ...t.params.map(() => E)];
    const c = () => m.ref.cast(ctx.anyConvertExtern(m.local.get(0, E)), info.ref);
    const built = ctx.withOwnLocals(params.length, () => {
      // A rest (or `arguments`) signature ends in a hidden array of the call's surplus arguments, which a fixed-arity
      // invoker has no way to receive (HOST_IMPORT_ABI has no variadic closure crossing yet): calling it from the
      // host is a TypeError rather than a call missing arguments.
      if (t.rest === true && t.restAbi === undefined || t.argumentsAll === true) {
        return m.block(null, [ctx.typeError("a compiled function with a rest parameter cannot be called through the host yet"), m.unreachable()], E);
      }
      const argExit = ctx.engineExit ?? exitTo;
      const args = t.params.map((p, i) => argExit(m.local.get(i + 1, E), p, { file: "", start: 0, end: 0 } as SrcLoc));
      const callExpr = callCode(m, m.struct.get(0, c(), binaryen.i32, false), [m.struct.get(1, c(), binaryen.structref, false), ...args], info.sig, info.result);
      return t.ret.kind === "void" || info.result === binaryen.none
        ? m.block(null, [info.result === binaryen.none ? callExpr : m.drop(callExpr), call("js.undefined", [], E, [])], E)
        : returnMarshal(callExpr, t.ret);
    });
    m.addFunction(fnName, binaryen.createType(params), E, built.locals, built.body);
    m.addFunctionExport(fnName, exportName);
    return exportName;
  };
  const returnMarshal = (v: number, t: IrType): number => {
    ctx.escape?.(t);
    switch (t.kind) {
      case "f64": return ctx.numToJs(v);
      case "bool": return call("js.fromBool", [I], E, [v]);
      case "string": case "jsval": case "symbol": case "bigint": return v;
      case "dyn": if (ctx.engineDyn) return v; if (ctx.dynToJs) return ctx.dynToJs(v); return ctx.unsupported("returning dyn to JavaScript");
      case "func": return ctx.fnToJs ? ctx.fnToJs(v, t) : call("js.fromFn", [E, E], E, [ctx.externConvertAny(v), ctx.stringConst(invoker(t))]);
      default: return ctx.valueToJs ? ctx.valueToJs(v, t) : ctx.unsupported(`returning ${t.kind} to JavaScript`);
    }
  };

  /* JS promise → static promise: the host subscribes and calls jsSettle. */
  let settleExported = false;
  const ensureSettle = () => {
    if (settleExported) return;
    settleExported = true;
    const rt = ctx.promiseBridge();
    // jsSettle(target, value, rejected): the settled engine value crosses as a
    // jsval, or (a dyn settle target, native dyn) as dyn.
    const target = () => ctx.anyConvertExtern(m.local.get(0, E));
    // A rejection's reason crosses as a caught page exception does.
    const reason = (fulfilled: () => number) => ctx.wrapJsError ? m.if(m.local.get(2, I), ctx.wrapJsError(m.local.get(1, E)), fulfilled()) : fulfilled();
    const raw = m.call(rt.settleInline, [m.ref.cast(target(), rt.ref), reason(() => ctx.anyConvertExtern(m.local.get(1, E))), m.local.get(2, I)], binaryen.none);
    const box = ctx.dynSettleBox?.(), nn = (t: number) => binaryen.getTypeFromHeapType(binaryen.getHeapType(t), false);
    m.addFunction("$jsSettle", binaryen.createType([E, E, I]), binaryen.none, [], box === undefined || !ctx.dynFromJs ? raw
      : m.if(m.ref.test(target(), nn(box)), m.call(rt.settleInline, [m.ref.cast(ctx.anyConvertExtern(m.struct.get(0, m.ref.cast(target(), nn(box)), E, false)), rt.ref),
        reason(() => ctx.dynFromJs!(m.local.get(1, E))), m.local.get(2, I)], binaryen.none), raw));
    m.addFunctionExport("$jsSettle", "jsSettle");
  };
  /** Settle the compiled promise behind `target` (externref) from the page value `value` (externref): Promise.resolve(value) on the page. */
  const bridgeTo = (value: number, target: number): number => {
    ensureSettle();
    return m.call(imp("js.bridgePromise", [E, E], binaryen.none), [value, target], binaryen.none);
  };
  const bridgePromise = (e: IrExpr & { kind: "jsBridgePromise" }): number => {
    const rt = ctx.promiseBridge();
    ensureSettle();
    const p = ctx.temp(rt.ref);
    // import(pkg) of a module outside the program: the host settles the target itself (§6 target/jsSettle, no host promise).
    const v = e.value;
    if (v.kind === "libCall" && v.fn === "island.importDyn")
      return m.block(null, [m.local.set(p, m.call(rt.create, [], rt.ref)),
        m.call(imp("island.importDyn", [E, E], binaryen.none), [ctx.expr(v.args[0]!), ctx.externConvertAny(m.local.get(p, rt.ref))], binaryen.none),
        m.local.get(p, rt.ref)], rt.ref);
    return m.block(null, [
      m.local.set(p, m.call(rt.create, [], rt.ref)),
      m.call(imp("js.bridgePromise", [E, E], binaryen.none), [ctx.expr(e.value), ctx.externConvertAny(m.local.get(p, rt.ref))], binaryen.none),
      m.local.get(p, rt.ref),
    ], rt.ref);
  };

  /** A closure as a page function through this bridge's own invokers. */
  const fnToJsDefault = (v: number, t: IrType & { kind: "func" }) => (ctx.escape?.(t), call)("js.fromFn", [E, E], E, [ctx.externConvertAny(v), ctx.stringConst(invoker(t))]);
  return { op, marshal, exit, bridgePromise, bridgeTo, exitTo, fnToJsDefault, constantHelper, ensureSettle };
}
