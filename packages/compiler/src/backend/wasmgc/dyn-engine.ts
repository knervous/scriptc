/* Engine-backed dyn: the checked-dynamic tier on the browser target.
 *
 * Untyped JavaScript compiled statically (npm packages such as React) lowers
 * to Scriptc's checked-dynamic IR. On the browser target a dyn value IS the
 * engine's own JS value (externref): property bags, prototypes, symbols and
 * functions are real engine objects, and every dynamic operation is a thin
 * host import. Compiled functions cross as cached JS wrappers that call back
 * through a per-signature invoker export, carrying `this` and the actual
 * argument list.
 *
 * Conventions: dyn undefined is the imported global `$dyn.undef` (a null
 * externref is JS null); `this` for the callee is the `$dyn.this` global,
 * set immediately before each call. */
import binaryen from "binaryen";
import { callCode } from "./types.js";
import type { IrExpr, IrType, SrcLoc } from "../../ir/ir.js";

export interface DynEngineContext {
  m: binaryen.Module;
  expr(e: IrExpr): number;
  host(name: string, params: number[], result: number): string;
  stringConst(value: string): number;
  externConvertAny(value: number): number;
  anyConvertExtern(value: number): number;
  valueType(t: IrType): number;
  typeKey(t: IrType): string;
  closureInfo(t: IrType & { kind: "func" }): { ref: number; sig: number; params: number[]; result: number; hidden: boolean };
  /** Typed value → engine value (the island marshal). */
  marshal(value: IrExpr): number;
  /** Engine value → typed value (strict exits). */
  exitTo(v: number, t: IrType, loc: SrcLoc): number;
  temp(type: number): number;
  unsupported(what: string, loc?: SrcLoc): never;
  /** An emitted value of a type with no direct engine form (unions, references). */
  valueToJs(v: number, t: IrType): number;
  withOwnLocals(paramCount: number, build: () => number): { body: number; locals: number[] };
  numToJs(v: number): number;
  numFromJs(v: number): number;
  /** A page wrapper's JS name and length for closure `c` (read twice). */
  fnMetaParts(c: () => number): [number, number, number];
  /** For closure `c` (read twice): whether it forwards to a page function, and that function. */
  fnForwardPage(c: () => number): [number, number];
  /** The host import module (`ns:host` when linked). */
  hostModule?: string;
}

const E = binaryen.externref, I = binaryen.i32, F = binaryen.f64;
export const DYN_UNDEF = "$dyn.undef", DYN_THIS = "$dyn.this";

const ARITH: Record<string, string> = { "-": "js.sub", "*": "js.mul", "/": "js.div", "%": "js.mod", "**": "js.pow" };
const BITWISE: Record<string, string> = { "&": "js.band", "|": "js.bor", "^": "js.bxor", "<<": "js.shl", ">>": "js.shr", ">>>": "js.ushr", "~": "js.bnot" };
const COMPARE: Record<string, string> = { "<": "js.lt", "<=": "js.le", ">": "js.gt", ">=": "js.ge" };
const OBJ_OP1: Record<string, string> = {
  "dyn.freeze": "freeze", "dyn.seal": "seal", "dyn.preventExtensions": "preventExtensions", "dyn.fromEntries": "fromEntries",
  "dyn.getOwnPropertyDescriptors": "getOwnPropertyDescriptors", "dyn.getOwnPropertyNames": "getOwnPropertyNames",
  "dyn.getOwnPropertySymbols": "getOwnPropertySymbols", "dyn.getPrototype": "getPrototypeOf", "dyn.objEntries": "entries",
  "dyn.objValues": "values", "dyn.objCreate": "create",
};
const TESTS = new Set(["string", "number", "boolean", "undefined", "null", "nullish", "array", "object", "function", "truthy", "symbol", "bigint", "error", "errorInstance"]);

export function dynEngine(ctx: DynEngineContext) {
  const { m } = ctx;
  const call = (name: string, params: number[], result: number, args: number[]) => m.call(ctx.host(name, params, result), args, result);
  const undef = () => m.global.get(DYN_UNDEF, E);
  let declared = false;
  /** The two module globals; called once the module exists. */
  const declare = () => {
    if (declared) return;
    declared = true;
    m.addGlobalImport(DYN_UNDEF, ctx.hostModule ?? "host", "undefined", E, false);
    m.addGlobal(DYN_THIS, E, true, m.ref.null(E));
  };
  const str = (e: IrExpr): string | null => e.kind === "strLit" ? e.value : null;
  const ps = (k: number) => Array<number>(k).fill(E);

  /** Set the callee's `this` after its arguments evaluated: the last
   * argument is wrapped so the set lands right before the call. */
  const withThis = (args: number[], argTypes: number[], thisValue: number): number[] => {
    if (!args.length) return args;
    const last = args.length - 1, t = ctx.temp(argTypes[last]!);
    return [...args.slice(0, last), m.block(null, [m.local.set(t, args[last]!), m.global.set(DYN_THIS, thisValue), m.local.get(t, argTypes[last]!)], argTypes[last]!)];
  };

  /* Typed → dyn. */
  const from = (value: IrExpr): number => {
    if (value.kind === "unitLit") return value.unit === "undefined" ? undef() : m.ref.null(E);
    switch (value.type.kind) {
      case "dyn": case "jsval": case "string": case "symbol": return ctx.expr(value);
      case "undefinedT": case "void": { const v = ctx.expr(value); return m.block(null, [binaryen.getExpressionType(v) === binaryen.none ? v : m.drop(v), undef()], E); }
      case "nullT": { const v = ctx.expr(value); return m.block(null, [binaryen.getExpressionType(v) === binaryen.none ? v : m.drop(v), m.ref.null(E)], E); }
      case "func": return fromFn(value);
      default: return ctx.marshal(value);
    }
  };

  /* Compiled function → engine function (cached per closure). */
  const invokers = new Map<string, string>();
  // The wrapper carries the function's JS name and length.
  const fnToJs = (v: number, t: IrType & { kind: "func" }): number => {
    const ref = ctx.closureInfo(t).ref, c = ctx.temp(ref), [name, length, flags] = ctx.fnMetaParts(() => m.local.get(c, ref));
    // A typed-slot view of a page function is that function again (identity).
    const [forwards, page] = ctx.fnForwardPage(() => m.local.get(c, ref));
    return m.block(null, [m.local.set(c, v), m.if(forwards, page,
      call("js.fromDynFnCached", [E, E, E, binaryen.i32, binaryen.i32], E, [ctx.externConvertAny(m.local.get(c, ref)), ctx.stringConst(invoker(t)), name, length, flags]))], E);
  };
  const fromFn = (value: IrExpr): number => fnToJs(ctx.expr(value), value.type as IrType & { kind: "func" });
  const invoker = (t: IrType & { kind: "func" }): string => {
    const key = ctx.typeKey(t);
    let name = invokers.get(key);
    if (name) return name;
    name = `dynInvoke${invokers.size}`;
    invokers.set(key, name);
    const info = ctx.closureInfo(t);
    const c = () => m.ref.cast(ctx.anyConvertExtern(m.local.get(0, E)), info.ref);
    const loc = { file: "", start: 0, end: 0 } as SrcLoc;
    const built = ctx.withOwnLocals(3, () => {
      // A typed rest parameter (restAbi) takes the tail of the arguments as its array.
      const restAt = t.restAbi !== undefined ? t.params.length - 1 : -1;
      const args = t.params.map((p, i) => ctx.exitTo(call(i === restAt ? "js.argsFrom" : "js.arg", [E, I], E, [m.local.get(2, E), m.i32.const(i)]), p, loc));
      if (info.hidden) args.push(t.argumentsAll ? m.local.get(2, E) : call("js.argsFrom", [E, I], E, [m.local.get(2, E), m.i32.const(t.params.length)]));
      const callExpr = callCode(m, m.struct.get(0, c(), binaryen.i32, false), [m.struct.get(1, c(), binaryen.structref, false), ...args], info.sig, info.result);
      return m.block(null, [
        m.global.set(DYN_THIS, m.local.get(1, E)),
        info.result === binaryen.none ? m.block(null, [callExpr, undef()], E) : result(callExpr, t.ret),
      ], E);
    });
    m.addFunction(`$${name}`, binaryen.createType([E, E, E]), E, built.locals, built.body);
    m.addFunctionExport(`$${name}`, name);
    return name;
  };
  const result = (v: number, t: IrType): number => {
    switch (t.kind) {
      case "dyn": case "jsval": case "string": case "symbol": return v;
      case "f64": return ctx.numToJs(v);
      case "bool": return call("js.fromBool", [I], E, [v]);
      case "undefinedT": return m.block(null, [m.drop(v), undef()], E);
      case "func": return fnToJs(v, t);
      default: return ctx.valueToJs(v, t);
    }
  };

  /* Expression kinds. */
  const keyGet = (e: IrExpr & { kind: "dynKeyGet" }): number => {
    if (!e.optional) return call("js.get", [E, E], E, [ctx.expr(e.value), keyOf(e.key)]);
    const v = ctx.temp(E);
    return m.block(null, [m.local.set(v, ctx.expr(e.value)),
      m.if(call("js.isNullish", [E], I, [m.local.get(v, E)]), undef(), call("js.get", [E, E], E, [m.local.get(v, E), keyOf(e.key)]))], E);
  };
  /** A property key: strings and dyn values cross as themselves, numbers as JS numbers. */
  const keyOf = (k: IrExpr): number => k.type.kind === "f64" ? ctx.numToJs(ctx.expr(k)) : from(k);

  const test = (e: IrExpr & { kind: "dynTest" }): number => {
    if (!TESTS.has(e.test)) return ctx.unsupported(`dynamic test ${e.test}`, e.loc);
    const v = ctx.expr(e.value);
    const r = e.test === "null" ? m.ref.is_null(v) : call(`js.is.${e.test === "errorInstance" ? "error" : e.test}`, [E], I, [v]);
    return e.negated ? m.i32.eqz(r) : r;
  };

  const scalarEq = (e: IrExpr & { kind: "dynScalarEq" }): number => {
    const r = call("js.eq", [E, E], I, [from(e.left), from(e.right)]);
    return e.negated ? m.i32.eqz(r) : r;
  };

  const hasKey = (e: IrExpr & { kind: "dynHasKey" }): number => {
    const r = call("js.hasProp", [E, E], I, [ctx.expr(e.value), ctx.stringConst(e.key)]);
    return e.negated ? m.i32.eqz(r) : r;
  };

  const arrLit = (e: IrExpr & { kind: "dynArrLit" }): number => {
    if (e.elems.length <= 16) return call(`js.arrLit.${e.elems.length}`, ps(e.elems.length), E, e.elems.map(from));
    const a = ctx.temp(E);
    return m.block(null, [m.local.set(a, call("js.arrLit.0", [], E, [])),
      ...e.elems.map(el => call("js.push", [E, E], binaryen.none, [m.local.get(a, E), from(el)])), m.local.get(a, E)], E);
  };

  const objLit = (e: IrExpr & { kind: "dynObjLit" }): number => {
    const fields = (e as { fields?: { key: IrExpr; value: IrExpr }[] }).fields ?? [];
    if (fields.length <= 12) return call(`js.objLit.${fields.length * 2}`, ps(fields.length * 2), E, fields.flatMap(f => [keyOf(f.key), from(f.value)]));
    const o = ctx.temp(E);
    return m.block(null, [m.local.set(o, call("js.objLit.0", [], E, [])),
      ...fields.map(f => call("js.set", [E, E, E], binaryen.none, [m.local.get(o, E), keyOf(f.key), from(f.value)])), m.local.get(o, E)], E);
  };

  const dynCall = (e: IrExpr & { kind: "dynCall" }): number => {
    const callee = ctx.expr(e.callee), recv = e.receiver ? from(e.receiver) : undef();
    if (e.spreads?.length) {
      // Build the flattened argument vector left to right, then apply.
      const a = ctx.temp(E), f = ctx.temp(E), r = ctx.temp(E);
      const spread = new Set(e.spreads.map(s => s.arg));
      return m.block(null, [m.local.set(f, callee), m.local.set(r, recv), m.local.set(a, call("js.arrLit.0", [], E, [])),
        ...e.args.map((x, i) => call(spread.has(i) ? "js.pushAll" : "js.push", [E, E], binaryen.none, [m.local.get(a, E), from(x)])),
        call("js.apply", [E, E, E], E, [m.local.get(f, E), m.local.get(r, E), m.local.get(a, E)])], E);
    }
    const n = e.args.length;
    return call(`js.dcall.${n}`, ps(n + 2), E, [callee, recv, ...e.args.map(from)]);
  };

  const invoke = (e: IrExpr & { kind: "dynInvoke" }): number => {
    const n = e.args.length;
    return call(`js.callMethod.${n}`, ps(n + 2), E, [ctx.expr(e.recv), ctx.stringConst(e.method), ...e.args.map(from)]);
  };

  /* Library calls over dyn. Returns null when the name is not a dyn op. */
  const lib = (fn: string, args: IrExpr[], type: IrType, loc: SrcLoc): number | null => {
    const a = (i: number) => from(args[i]!);
    switch (fn) {
      case "dyn.this": case "dyn.generatorThis": return m.global.get(DYN_THIS, E);
      case "dyn.add": return call("js.add", [E, E], E, [a(0), a(1)]);
      case "dyn.arithmetic": { const op = ARITH[str(args[2]!) ?? ""]; return op ? call(op, [E, E], E, [a(0), a(1)]) : ctx.unsupported(`dyn arithmetic ${str(args[2]!)}`, loc); }
      case "dyn.bitwise": { const op = BITWISE[str(args[2]!) ?? ""]; return op ? call(op, [E, E], E, [a(0), a(1)]) : ctx.unsupported(`dyn bitwise ${str(args[2]!)}`, loc); }
      case "dyn.compare": { const op = COMPARE[str(args[2]!) ?? ""]; return op ? call(op, [E, E], I, [a(0), a(1)]) : ctx.unsupported(`dyn compare ${str(args[2]!)}`, loc); }
      case "dyn.toNumeric": return call("js.toNumeric", [E], E, [a(0)]);
      case "dyn.increment": return call("js.inc", [E, I], E, [a(0), ctx.expr(args[1]!)]);
      case "dyn.bagGet": return call("js.reflectGet", [E, E, E], E, [a(0), keyOf(args[1]!), a(2)]);
      case "dyn.keySet": case "dyn.keySetComputed": return call("js.set", [E, E, E], binaryen.none, [a(0), keyOf(args[1]!), a(2)]);
      case "dyn.keyDeleteComputed": return call("js.delete", [E, E, I], binaryen.none, [a(0), keyOf(args[1]!), ctx.expr(args[2]!)]);
      case "dyn.hasKey": case "dyn.hasKeyComputed": return call("js.hasProp", [E, E], I, [a(0), keyOf(args[1]!)]);
      case "dyn.nativeSetNew": return call("js.newSet", [E], E, [a(0)]);
      case "dyn.construct": return call("js.construct", [E, E], E, [a(0), a(1)]);
      case "dyn.objKeys": return call("js.keys", [E], E, [a(0)]);
      case "dyn.forInKeys": return call("js.forInKeys", [E], E, [a(0)]);
      case "dyn.builtinMethod": return call("js.builtinMethod", [E, E], E, [ctx.expr(args[0]!), ctx.expr(args[1]!)]);
      case "dyn.defineProperty": return call("js.defineProperty", [E, E, E], E, [a(0), keyOf(args[1]!), a(2)]);
      case "dyn.getOwnPropertyDescriptor": return call("js.getOwnPropertyDescriptor", [E, E], E, [a(0), keyOf(args[1]!)]);
      case "dyn.assign": return call("js.assign", [E, E], E, [a(0), a(1)]);
      // assignAll(target, sources): every element of the sources array.
      case "dyn.assignAll": return call("js.assignAll", [E, E], E, [a(0), a(1)]);
      case "dyn.setPrototype": return call("js.setPrototype", [E, E], E, [a(0), a(1)]);
      case "error.toString": return call("js.toStrOp", [E], E, [a(0)]);
      case "dyn.sameValue": return call("js.sameValue", [E, E], I, [a(0), a(1)]);
      case "dyn.stringConstructor": return call("js.toStrOp", [E], E, [a(0)]);
      // ToString proper (templates, string-taking builtins): a Symbol throws, unlike String(v).
      case "dyn.toStringCoerce": return call("js.toStrStrict", [E], E, [a(0)]);
      case "dyn.typeof": return call("js.typeof", [E], E, [a(0)]);
      case "dyn.reflectGet": return call("js.reflectGet", [E, E, E], E, [a(0), keyOf(args[1]!), a(2)]);
      // Plain engine equivalents (Object/Reflect/Array built-ins).
      case "dyn.abstractEq": return call("js.looseEq", [E, E], I, [a(0), a(1)]);
      case "dyn.arrAt": return call("js.get", [E, E], E, [a(0), ctx.numToJs(ctx.expr(args[1]!))]);
      case "dyn.arrLen": return ctx.numFromJs(call("js.toNum", [E], F, [call("js.get", [E, E], E, [a(0), ctx.stringConst("length")])]));
      case "dyn.arrayConstructor": return call("js.global", [E], E, [ctx.stringConst("Array")]);
      // Engine dyn: the page's own Map/Set.
      case "dyn.newCollection": {
        const kind = args[0]!.kind === "strLit" ? args[0].value : null;
        if (kind !== "Map" && kind !== "Set") return null;
        return call("js.construct.1", [E, E], E, [call("js.global", [E], E, [ctx.stringConst(kind)]), a(1)]);
      }
      case "weakMap.new": case "weakSet.new": return call("js.construct.1", [E, E], E, [call("js.global", [E], E, [ctx.stringConst(fn === "weakMap.new" ? "WeakMap" : "WeakSet")]), a(0)]);
      case "bytes.instanceOf": return call("js.instanceOf", [E, E], I, [a(0), a(1)]);
      case "weakMap.is": case "weakSet.is": return call("js.instanceOf", [E, E], I, [a(0), call("js.global", [E], E, [ctx.stringConst(fn === "weakMap.is" ? "WeakMap" : "WeakSet")])]);
      case "dyn.nativeDateIs": return call("js.instanceOf", [E, E], I, [a(0), call("js.global", [E], E, [ctx.stringConst("Date")])]);
      case "dyn.constructorStatics": return a(0);
      case "dyn.objectConstructorValue": return call("js.global", [E], E, [ctx.stringConst("Object")]);
      case "dyn.arrayConstructorValue": return call("js.global", [E], E, [ctx.stringConst("Array")]);
      case "dyn.reflectValue": return call("js.global", [E], E, [ctx.stringConst("Reflect")]);
      case "dyn.reflectConstruct": return call("js.callMethod.3", [E, E, E, E, E], E, [call("js.global", [E], E, [ctx.stringConst("Reflect")]), ctx.stringConst("construct"), a(0), a(1), a(2)]);
      case "error.prepareStackTraceGet": return call("js.get", [E, E], E, [call("js.global", [E], E, [ctx.stringConst("Error")]), ctx.stringConst("prepareStackTrace")]);
      case "error.prepareStackTraceSet": return call("js.set", [E, E, E], binaryen.none, [call("js.global", [E], E, [ctx.stringConst("Error")]), ctx.stringConst("prepareStackTrace"), a(0)]);
      // A typed-array constructor read as a value (`new Float32Array(...)` through a bound constructor): the page's own global.
      case "bytes.constructor": case "dyn.collectionCtor": return call("js.global", [E], E, [ctx.expr(args[0]!)]);
      case "dyn.arrayPrototype": return call("js.protoOf", [E], E, [ctx.stringConst("Array")]);
      case "dyn.objectPrototype": return call("js.protoOf", [E], E, [ctx.stringConst("Object")]);
      case "dyn.functionApply": return call("js.builtinMethod", [E, E], E, [ctx.stringConst("Function"), ctx.stringConst("apply")]);
      // Array.from's source as an iterator (dyn.iterPack packs to an array).
      case "dyn.arrayFromIterator": return call("js.arrayFromIterator", [E], E, [a(0)]);
      case "dyn.iterPack": return call("js.arrayFrom", [E], E, [a(0)]);
      // The iteration protocol (for-of, yield*, collection seeding): the page's own.
      case "dyn.iterator": return call("js.iterator", [E, E], E, [a(0), args[1] ? ctx.expr(args[1]) : ctx.stringConst("")]);
      case "json.stringifyReplacer": return call("js.jsonStringify", [E, E, E], E, [a(0), a(1), ctx.expr(args[2]!)]);
      case "json.stringifyValue": return call("js.jsonStringifyAll", [E, E, E], E, [a(0), a(1), a(2)]);
      case "dyn.iteratorResult": return call("js.iterResult", [E], E, [a(0)]);
      // Engine dyn iterates every source in the page: nothing is opened ahead of the constructor.
      case "dyn.needsOpen": return m.i32.const(0);
      case "dyn.opened": return a(0);
      case "dyn.arrayProtoCall": return call("js.arrayProtoCall", [E, E, E], E, [a(0), ctx.expr(args[1]!), a(2)]);
      case "dyn.bagSet": return m.drop(call("js.reflectSet", [E, E, E, E], I, [a(0), keyOf(args[1]!), a(2), a(3)]));
      case "dyn.reflectSet": return call("js.reflectSet", [E, E, E, E], I, [a(0), keyOf(args[1]!), a(2), a(3)]);
      case "dyn.reflectApply": return call("js.apply", [E, E, E], E, [a(0), a(1), a(2)]);
      case "dyn.reflectDefine": return call("js.reflectDefine", [E, E, E], I, [a(0), keyOf(args[1]!), a(2)]);
      case "dyn.reflectSetData": return call("js.receiverSetData", [E, E, E], I, [a(0), keyOf(args[1]!), a(2)]);
      case "dyn.copyDataProperties": return call("js.assign", [E, E], E, [a(0), a(1)]);
      case "dyn.defineProps": return call("js.objOp2", [E, E, E], E, [ctx.stringConst("defineProperties"), a(0), a(1)]);
      case "dyn.objCreateWithProperties": return call("js.objOp2", [E, E, E], E, [ctx.stringConst("create"), a(0), a(1)]);
      case "dyn.freeze": case "dyn.seal": case "dyn.preventExtensions": case "dyn.fromEntries": case "dyn.getOwnPropertyDescriptors":
      case "dyn.getOwnPropertyNames": case "dyn.getOwnPropertySymbols": case "dyn.getPrototype": case "dyn.objEntries": case "dyn.objValues": case "dyn.objCreate":
        return call("js.objOp1", [E, E], E, [ctx.stringConst(OBJ_OP1[fn]!), a(0)]);
      case "dyn.isExtensible": case "dyn.isFrozen": case "dyn.isSealed":
        return call("js.truthy", [E], I, [call("js.objOp1", [E, E], E, [ctx.stringConst(fn.slice(4)), a(0)])]);
      case "dyn.objCreateNullProto": return call("js.objOp1", [E, E], E, [ctx.stringConst("create"), m.ref.null(E)]);
      // structuredClone: the page's own (engine dyn values ARE page values), options validated by it.
      case "dyn.structuredClone": return call("js.structuredClone", [E, E], E, [a(0), a(1)]);
      case "dyn.cloneMissing": return call("js.cloneMissing", [], E, []);
      case "dyn.cloneTransferFail": return call("js.cloneTransferFail", [], E, []);
      case "dyn.ownKeys": return call("js.ownKeys", [E], E, [a(0)]);
      case "dyn.hasOwn": case "dyn.hasOwnComputed": return call("js.hasOwn", [E, E], I, [a(0), keyOf(args[1]!)]);
      case "dyn.propertyIsEnumerable": case "dyn.propertyIsEnumerableComputed": return call("js.isEnumerable", [E, E], I, [a(0), keyOf(args[1]!)]);
      case "dyn.keyDelete": return call("js.delete", [E, E, I], binaryen.none, [a(0), keyOf(args[1]!), ctx.expr(args[2]!)]);
      case "dyn.numberConstructor": case "dyn.toNumberCoerce": return ctx.numFromJs(call("js.toNumber", [E], F, [a(0)]));
      case "dyn.propertyKey": return call("js.propertyKey", [E], E, [a(0)]);
      case "dyn.objectRest": return call("js.objectRest", [E, E], E, [a(0), a(1)]);
      case "dyn.packPush": return call("js.push", [E, E], binaryen.none, [a(0), a(1)]);
      case "dyn.packPushSpread": return call("js.pushAll", [E, E], binaryen.none, [a(0), a(1)]);
      case "sym.for": return call("js.symFor", [E], E, [ctx.expr(args[0]!)]);
      case "sym.wellKnown": return call("js.symWellKnown", [E], E, [ctx.expr(args[0]!)]);
      default: void type; return null;
    }
  };

  /** A dyn value as a wasm condition (JS truthiness). */
  const truthy = (v: number): number => call("js.truthy", [E], I, [v]);

  return { declare, fnToJs, from, fromFn, keyGet, keyOf, test, scalarEq, hasKey, arrLit, objLit, dynCall, invoke, lib, truthy, undef, withThis };
}
