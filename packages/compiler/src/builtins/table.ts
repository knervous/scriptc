/* The builtin table (review §40): one entry per builtin method, shared by the
 * layers that each used to describe builtins their own way.
 *
 *   - `impl`: how a compiled receiver is served. `wasm`: a Wasm implementation
 *     on our object model (backend/wasmgc arrayMethodCall); `direct`: also a
 *     walk that calls a statically known callback directly (DIRECT_ARRAY_METHODS);
 *     neither: the shared invoke helper, which may reach the page.
 *   - `flow`: what the call does with values, for the points-to analysis
 *     (ir/points-to.ts reads it): which arguments become elements, what a
 *     callback's parameters receive, and what the call returns.
 *
 * A builtin missing from the table is unmodeled in the analysis (its result is
 * U, and the precision report names it), so coverage gaps are one listing.
 * Extend the table, not a layer's private switch. */

/** A value a builtin's flow names. `element`: an element of the receiver (an
 * array's computed slot, a collection's entries); `receiver`: the receiver
 * itself; `int`/`num`/`bool`/`str`/`undef`: a primitive of that kind;
 * `callbackResult`: what the callback returns; `accumulator`: reduce's running
 * value (the initial value, elements and callback results). */
export type FlowValue = "element" | "receiver" | "int" | "num" | "bool" | "str" | "undef" | "callbackResult" | "accumulator" | "arg0";

/** A fresh array (one per call site) holding these values: `{ args: i }`: the
 * arguments from position i, and their elements too (concat flattens arrays). */
export type FlowItem = Exclude<FlowValue, "receiver"> | { args: number };
export interface FreshArray { fresh: readonly FlowItem[] }

export interface BuiltinFlow {
  /** Arguments from this position on become elements of the receiver (push, a Set's add). */
  argsInto?: number;
  /** For a collection: the argument that becomes an entry's value (a Map's set: 1). */
  valueArg?: number;
  /** A callback argument and what each of its parameters receives. */
  callback?: { arg: number; params: readonly ("element" | "index" | "receiver" | "accumulator" | "key")[] };
  /** What the call returns (each listed value may be the result); `arg0`: the first argument. */
  returns: readonly (FlowValue | FreshArray)[];
  /** Object.assign: every own field of the arguments after the first is copied onto the first. */
  copiesFields?: true;
}

/** `static`: a function value (`Object.keys`), its method the full name. */
export type BuiltinReceiver = "array" | "collection" | "string" | "number" | "boolean" | "static";

export interface BuiltinSpec {
  /** Spec-style name, e.g. `Array.prototype.find`. */
  name: string;
  receiver: BuiltinReceiver;
  method: string;
  impl: { wasm: boolean; direct?: boolean };
  flow: BuiltinFlow;
}

const each = ["element", "index", "receiver"] as const;
const array = (method: string, flow: BuiltinFlow, impl: BuiltinSpec["impl"]): BuiltinSpec =>
  ({ name: `Array.prototype.${method}`, receiver: "array", method, impl, flow });
const W = { wasm: true }, D = { wasm: true, direct: true }, S = { wasm: false };

export const BUILTINS: readonly BuiltinSpec[] = [
  // ── Array.prototype ──
  array("push", { argsInto: 0, returns: ["int"] }, W),
  array("unshift", { argsInto: 0, returns: ["int"] }, W),
  array("pop", { returns: ["element", "undef"] }, W),
  array("shift", { returns: ["element", "undef"] }, W),
  array("at", { returns: ["element", "undef"] }, S),
  array("slice", { returns: [{ fresh: ["element"] }] }, W),
  array("splice", { returns: [{ fresh: ["element", { args: 2 }] }] }, W),
  array("concat", { returns: [{ fresh: ["element", { args: 0 }] }] }, W),
  array("flat", { returns: [{ fresh: ["element"] }] }, S),
  array("reverse", { returns: [{ fresh: ["element"] }, "receiver"] }, W),
  array("sort", { returns: [{ fresh: ["element"] }, "receiver"] }, W),
  array("fill", { returns: [{ fresh: ["element"] }, "receiver"] }, W),
  array("indexOf", { returns: ["int"] }, W),
  array("lastIndexOf", { returns: ["int"] }, W),
  array("includes", { returns: ["bool"] }, W),
  array("join", { returns: ["str"] }, W),
  array("findIndex", { callback: { arg: 0, params: each }, returns: ["int"] }, D),
  array("some", { callback: { arg: 0, params: each }, returns: ["bool"] }, D),
  array("every", { callback: { arg: 0, params: each }, returns: ["bool"] }, D),
  array("forEach", { callback: { arg: 0, params: each }, returns: ["undef"] }, D),
  array("find", { callback: { arg: 0, params: each }, returns: ["element", "undef"] }, D),
  array("filter", { callback: { arg: 0, params: each }, returns: [{ fresh: ["element"] }] }, D),
  array("map", { callback: { arg: 0, params: each }, returns: [{ fresh: ["callbackResult"] }] }, D),
  array("reduce", { callback: { arg: 0, params: ["accumulator", "element", "index", "receiver"] }, returns: ["accumulator"] }, D),
  array("reduceRight", { callback: { arg: 0, params: ["accumulator", "element", "index", "receiver"] }, returns: ["accumulator"] }, S),
  array("keys", { returns: [{ fresh: ["int"] }] }, S),
  array("values", { returns: [{ fresh: ["element"] }] }, S),
  array("entries", { returns: [{ fresh: ["int"] }] }, S),

  // ── Map / Set / WeakMap / WeakSet (entries live in one slot: a Map's values, a Set's members) ──
  ...([
    ["get", { returns: ["element", "undef"] }],
    ["set", { valueArg: 1, returns: ["receiver"] }],
    ["add", { valueArg: 0, returns: ["receiver"] }],
    ["has", { returns: ["bool"] }],
    ["delete", { returns: ["bool"] }],
    ["clear", { returns: ["undef"] }],
    ["forEach", { callback: { arg: 0, params: ["element", "key", "receiver"] }, returns: ["undef"] }],
    ["keys", { returns: [{ fresh: ["element"] }] }],
    ["values", { returns: [{ fresh: ["element"] }] }],
    ["entries", { returns: [{ fresh: ["element"] }] }],
    ["hasOwnProperty", { returns: ["bool"] }],
    ["toString", { returns: ["str"] }],
  ] as [string, BuiltinFlow][]).map(([method, flow]): BuiltinSpec => ({ name: `Map.prototype.${method}`, receiver: "collection", method, impl: S, flow })),

  // ── String / Number / Boolean prototypes, by result kind ──
  ...["slice", "substring", "substr", "toLowerCase", "toUpperCase", "trim", "trimStart", "trimEnd", "replace", "replaceAll", "charAt", "padStart", "padEnd", "repeat", "concat",
    "toString", "toFixed", "toPrecision", "normalize", "at", "toLocaleString", "toLocaleLowerCase", "toLocaleUpperCase", "toExponential", "anchor", "big", "link", "sub", "sup"]
    .map((method): BuiltinSpec => ({ name: `String.prototype.${method}`, receiver: "string", method, impl: S, flow: { returns: ["str"] } })),
  ...["indexOf", "lastIndexOf", "charCodeAt", "codePointAt", "localeCompare", "search"]
    .map((method): BuiltinSpec => ({ name: `String.prototype.${method}`, receiver: "string", method, impl: S, flow: { returns: ["int"] } })),
  { name: "Number.prototype.valueOf", receiver: "number", method: "valueOf", impl: S, flow: { returns: ["num"] } },
  ...["startsWith", "endsWith", "includes", "isWellFormed", "hasOwnProperty", "propertyIsEnumerable", "isPrototypeOf"]
    .map((method): BuiltinSpec => ({ name: `String.prototype.${method}`, receiver: "string", method, impl: S, flow: { returns: ["bool"] } })),
  ...["split", "match", "matchAll"]
    .map((method): BuiltinSpec => ({ name: `String.prototype.${method}`, receiver: "string", method, impl: S, flow: { returns: [{ fresh: ["str"] }] } })),
];

/** Math functions whose result is an integer (an int32 for the int32-range inputs that matter here). */
const INT_MATH = ["floor", "ceil", "round", "trunc", "clz32", "imul", "sign"];
const NUM_MATH = ["abs", "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh", "cbrt", "cos", "cosh", "exp", "expm1", "fround", "hypot", "log", "log10", "log1p", "log2", "max", "min", "pow", "random", "sin", "sinh", "sqrt", "tan", "tanh"];
const fnValue = (name: string, flow: BuiltinFlow): BuiltinSpec => ({ name, receiver: "static", method: name, impl: S, flow });
/** Builtin function values (dyn.builtinFunction / dyn.builtinMethod): what calling one returns. */
export const STATIC_BUILTINS: readonly BuiltinSpec[] = [
  ...["Object.is", "Object.hasOwnProperty", "Array.isArray", "Object.isFrozen", "Number.isNaN", "Number.isInteger"].map(n => fnValue(n, { returns: ["bool"] })),
  ...["Object.keys", "Object.getOwnPropertyNames"].map(n => fnValue(n, { returns: [{ fresh: ["str"] }] })),
  fnValue("Object.assign", { returns: ["arg0"], copiesFields: true }),
  ...["Object.freeze", "Object.seal", "Object.preventExtensions"].map(n => fnValue(n, { returns: ["arg0"] })),
  fnValue("String", { returns: ["str"] }), fnValue("Number", { returns: ["num"] }), fnValue("Boolean", { returns: ["bool"] }),
  ...["Object.toString", "Function.toString", "Array.toString"].map(n => fnValue(n, { returns: ["str"] })),
  ...INT_MATH.map(n => fnValue(`Math.${n}`, { returns: ["int"] })),
  ...NUM_MATH.map(n => fnValue(`Math.${n}`, { returns: ["num"] })),
];

const byKey = new Map<string, BuiltinSpec>([...BUILTINS, ...STATIC_BUILTINS].map(b => [`${b.receiver}.${b.method}`, b]));
/** The builtin `method` of a receiver kind; primitives other than strings share the string entries (their common prototype methods). */
export function builtinMethod(receiver: BuiltinReceiver, method: string): BuiltinSpec | undefined {
  return byKey.get(`${receiver}.${method}`) ?? (receiver === "number" || receiver === "boolean" ? byKey.get(`string.${method}`) : undefined);
}
/** Methods the table models for a receiver kind. */
export function builtinMethods(receiver: BuiltinReceiver): ReadonlySet<string> {
  return new Set([...BUILTINS, ...STATIC_BUILTINS].filter(b => b.receiver === receiver).map(b => b.method));
}
/** A builtin function value by its full name (`Object.keys`, `Math.floor`). */
export function builtinFunction(name: string): BuiltinSpec | undefined {
  return byKey.get(`static.${name}`) ?? (name.startsWith("Math.") ? byKey.get(`static.Math.${name.slice(5).toLowerCase()}`) : undefined);
}
