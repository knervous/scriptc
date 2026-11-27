// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import * as ts from "../ts7/adapter.js";
import { BOOL, DYN, F64, NULL_T, STRING, SYMBOL_T, UNDEFINED_T, arrayOf, type IrType, type IrExpr, type IrLibFn, type IrStmt, type SrcLoc } from "../../ir/ir.js";
import { strLit, varRef } from "../../ir/build.js";
import type { Lowerer } from "./lowerer.js";
import { lowerArrayFromValue } from "./lower-containers.js";
import { primitiveCtorClosure } from "./lower-exprs.js";
import { NUMBER_CONSTANTS, NUMBER_STATIC_PREDICATES } from "./lower-builtins.js";
import { nodeThrowExpr } from "./lowerer.js";
import { BUILTIN_MODULE_CONSTS, BUILTIN_MODULE_FNS, OBJECT_CALLABLE_VALUES, builtinConstLit, builtinModuleConstOf, builtinModulesArrayLit, stdlibGlobalNameOf } from "./surfaces.js";

const PROTOTYPE_METHODS: Record<string, readonly string[]> = {
  Date: ["getTime", "valueOf", "toISOString", "toJSON"],
  Map: ["get", "set", "has", "delete", "clear", "keys", "values", "entries", "forEach"],
  Set: ["add", "has", "delete", "clear", "keys", "values", "entries", "forEach"],
  WeakMap: ["get", "set", "has", "delete"],
  WeakSet: ["add", "has", "delete"],
  String: ["split", "startsWith", "endsWith", "substring", "slice", "toLowerCase", "toUpperCase", "padStart", "charCodeAt", "normalize", "replace", "toString", "valueOf"],
  Number: ["toString", "valueOf"],
  Object: ["hasOwnProperty", "propertyIsEnumerable", "toString", "valueOf"],
};

export function builtinPrototypeMethod(lowerer: Lowerer, expr: ts.PropertyAccessExpression): string | null {
  const prototype = expr.expression;
  if (!ts.isPropertyAccessExpression(prototype) || prototype.name.text !== "prototype") return null;
  const owner = stdlibGlobalNameOf(lowerer, prototype.expression);
  return owner && PROTOTYPE_METHODS[owner]?.includes(expr.name.text) ? owner : null;
}

/** These native callables own their argument checks. Unannotated JS aliases
 * keep the checked value instead of narrowing it to the ambient signature.
 * This selects storage only: reassignment still updates a real runtime slot. */
export function isNativeBuiltinValueInitializer(lowerer: Lowerer, expr: ts.Expression | undefined, seen = new Set<ts.Symbol>()): boolean {
  if (!expr) return false;
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
  const builtin = ts.isIdentifier(expr) ? lowerer.builtinImportOf(expr)
    : ts.isPropertyAccessExpression(expr) ? lowerer.builtinMemberOf(expr) : null;
  if (builtin?.module === "util/types") return true;
  if (builtin?.module === "util" && ["stripVTControlCharacters", "toUSVString", "isDeepStrictEqual", "styleText"].includes(builtin.member)) return true;
  // JS global snapshots may use an opaque builtin identity rather than
  // the ambient constructor's callable ABI. Store that actual value in
  // the checked representation, including optional capability probes.
  const global = ts.isIdentifier(expr) ? stdlibGlobalNameOf(lowerer, expr) : null;
  if (global && !["undefined", "Infinity", "NaN"].includes(global)) return true;
  if (lowerer.isStdlibGlobal(expr, "console")) return true;
  if (ts.isNewExpression(expr) && lowerer.isStdlibGlobal(expr.expression, "Date")) return true;
  if (ts.isConditionalExpression(expr)) {
    return isNativeBuiltinValueInitializer(lowerer, expr.whenTrue, new Set(seen)) ||
      isNativeBuiltinValueInitializer(lowerer, expr.whenFalse, new Set(seen));
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return builtinPrototypeMethod(lowerer, expr) !== null ||
      lowerer.stdlibGlobalMember(expr, "console") !== null ||
      lowerer.stdlibGlobalMember(expr, "globalThis") === "console" ||
      lowerer.stdlibGlobalMember(expr, "process") === "getBuiltinModule" ||
      lowerer.stdlibGlobalMember(expr, "process") === "hrtime" ||
      (expr.name.text === "bigint" && ts.isPropertyAccessExpression(expr.expression) &&
        lowerer.stdlibGlobalMember(expr.expression, "process") === "hrtime") ||
      lowerer.stdlibGlobalMember(expr, "Array") === "isArray" ||
      lowerer.stdlibGlobalMember(expr, "Array") === "from" ||
      lowerer.stdlibGlobalMember(expr, "Reflect") === "ownKeys" ||
      ["fromCharCode", "fromCodePoint"].includes(lowerer.stdlibGlobalMember(expr, "String") ?? "") ||
      ["parseInt", "parseFloat"].includes(lowerer.stdlibGlobalMember(expr, "Number") ?? "") ||
      lowerer.stdlibGlobalMember(expr, "Buffer") === "isBuffer" ||
      lowerer.stdlibGlobalMember(expr, "Array") === "prototype" ||
      (ts.isPropertyAccessExpression(expr.expression) && lowerer.stdlibGlobalMember(expr.expression, "Array") === "prototype") ||
      lowerer.stdlibGlobalMember(expr, "Object") === "assign" ||
      lowerer.stdlibGlobalMember(expr, "Object") === "create" ||
      (expr.name.text === "apply" && ts.isPropertyAccessExpression(expr.expression) && lowerer.stdlibGlobalMember(expr.expression, "Function") === "prototype") ||
      lowerer.stdlibGlobalMember(expr, "JSON") === "stringify" ||
      (lowerer.isStdlibGlobal(expr.expression, "Object") && Object.hasOwn(OBJECT_CALLABLE_VALUES, expr.name.text));
  }
  if (!ts.isIdentifier(expr)) return false;
  const symbol = lowerer.resolveValueSymbol(expr);
  if (!symbol || seen.has(symbol)) return false;
  seen.add(symbol);
  return lowerer.checker.declarationsOf(symbol).some((decl) =>
    ts.isVariableDeclaration(decl) && isNativeBuiltinValueInitializer(lowerer, decl.initializer, seen));
}

/** The stored Array.isArray function shares the direct call's native test. */
export function lowerArrayIsArrayValue(lowerer: Lowerer, loc: SrcLoc): IrExpr {
  const key = "%builtin.Array.isArray";
  let name = lowerer.builtinCallableValueFns.get(key);
  if (!name) {
    name = key;
    lowerer.builtinCallableValueFns.set(key, name);
    lowerer.liftedFns.push({
      name, params: [{ localId: "value", name: "value", type: DYN }], returnType: BOOL,
      locals: [{ id: "value", name: "value", type: DYN, mutable: false }],
      body: [{ kind: "return", value: { kind: "dynTest", test: "array", value: varRef("value", DYN, loc), type: BOOL, loc }, loc }],
      loc,
    });
  }
  return { kind: "closure", fnName: name, captures: [], type: { kind: "func", params: [DYN], ret: BOOL }, loc };
}

export function lowerStringCodesValue(lowerer: Lowerer, member: "fromCharCode" | "fromCodePoint", loc: SrcLoc): IrExpr {
  const name = `%builtin.String.${member}`;
  if (!lowerer.liftedFns.some((fn) => fn.name === name)) {
    const values = varRef("values", DYN, loc), index = varRef("index", F64, loc), codes = varRef("codes", arrayOf(F64), loc), code = varRef("code", F64, loc);
    const number = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
    lowerer.liftedFns.push({ name, jsName: member, jsLength: 1, params: [{ localId: "first", name: "first", type: DYN }, { localId: "values", name: "values", type: DYN }], returnType: STRING,
      locals: [{ id: "first", name: "first", type: DYN, mutable: false }, { id: "values", name: "values", type: DYN, mutable: false },
        { id: "codes", name: "codes", type: arrayOf(F64), mutable: false }, { id: "index", name: "index", type: F64, mutable: true }, { id: "code", name: "code", type: F64, mutable: false }], loc,
      body: [
        { kind: "varDecl", localId: "codes", init: { kind: "arrayLit", elems: [], type: arrayOf(F64), loc }, loc },
        { kind: "varDecl", localId: "index", init: number(0), loc },
        { kind: "while", cond: { kind: "bin", op: "<", left: index, right: { kind: "dynCheck", value: { kind: "dynKeyGet", value: values, key: strLit("length", loc), type: DYN, loc }, type: F64, loc }, type: BOOL, loc }, loc, body: [
          { kind: "varDecl", localId: "code", init: { kind: "libCall", fn: "dyn.toNumberCoerce", args: [{ kind: "dynKeyGet", value: values, key: lowerer.coerceToExpected(index, DYN), type: DYN, loc }], type: F64, loc }, loc },
          ...(member === "fromCodePoint" ? [{ kind: "exprStmt" as const, expr: { kind: "libCall" as const, fn: "string.fromCodePoint" as const,
            args: [{ kind: "arrayLit" as const, elems: [code], type: arrayOf(F64), loc }], type: STRING, loc }, loc }] : []),
          { kind: "exprStmt", expr: { kind: "arrIntrinsic", method: "push", receiver: codes, args: [code], type: F64, loc }, loc },
          { kind: "assign", localId: "index", value: { kind: "bin", op: "+", left: index, right: number(1), type: F64, loc }, loc },
        ] },
        { kind: "return", value: { kind: "libCall", fn: `string.${member}`, args: [codes], type: STRING, loc }, loc },
      ],
    });
  }
  return { kind: "dynFrom", value: { kind: "closure", fnName: name, captures: [], type: { kind: "func", params: [DYN], ret: STRING, rest: true, argumentsAll: true }, loc }, fnName: member, type: DYN, loc };
}

export function lowerCheckedPredicateValue(lowerer: Lowerer, display: string, test: "number" | "buffer", loc: SrcLoc, predicate?: IrLibFn): IrExpr {
  const name = `%builtin.${display}`;
  if (!lowerer.liftedFns.some((fn) => fn.name === name)) {
    const value = varRef("value", DYN, loc);
    const matches: IrExpr = { kind: "dynTest", test, value, type: BOOL, loc };
    const result: IrExpr = predicate ? { kind: "ternary", cond: matches,
      then: { kind: "libCall", fn: predicate, args: [{ kind: "dynCheck", value, type: F64, loc }], type: BOOL, loc },
      else_: { kind: "boolLit", value: false, type: BOOL, loc }, type: BOOL, loc } : matches;
    lowerer.liftedFns.push({ name, params: [{ localId: "value", name: "value", type: DYN }], returnType: BOOL,
      locals: [{ id: "value", name: "value", type: DYN, mutable: false }], body: [{ kind: "return", value: result, loc }], loc });
  }
  return { kind: "closure", fnName: name, captures: [], type: { kind: "func", params: [DYN], ret: BOOL }, loc };
}

export function lowerNumberParserValue(lowerer: Lowerer, member: "parseInt" | "parseFloat", loc: SrcLoc): IrExpr {
  const name = `%builtin.Number.${member}`;
  const types = member === "parseInt" ? [DYN, DYN] : [DYN];
  if (!lowerer.liftedFns.some((fn) => fn.name === name)) {
    const params = types.map((type, index) => ({ localId: `p.${index}`, name: `p${index}`, type }));
    const text: IrExpr = { kind: "libCall", fn: "dyn.toStringCoerce", args: [varRef("p.0", DYN, loc)], type: STRING, loc };
    const radix: IrExpr = { kind: "libCall", fn: "dyn.toNumberCoerce", args: [varRef("p.1", DYN, loc)], type: F64, loc };
    lowerer.liftedFns.push({ name, params, returnType: F64, locals: params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
      body: [{ kind: "return", value: { kind: "libCall", fn: `num.${member}`, args: member === "parseInt" ? [text, radix] : [text], type: F64, loc }, loc }], loc });
  }
  return { kind: "dynFrom", value: { kind: "closure", fnName: name, captures: [], type: { kind: "func", params: types, ret: F64 }, loc }, fnName: member, type: DYN, loc };
}

// These module values expose existing native callable lowerings and main-thread
// metadata. Other exports keep an explicit runtime refusal, including Worker.
const MODULES = ["path/posix", "path/win32", "os", "worker_threads", "util/types"] as const;

const box = (value: IrExpr): IrExpr => value.type.kind === "dyn" ? value : { kind: "dynFrom", value, type: DYN, loc: value.loc };

export function pathModuleValue(lowerer: Lowerer, module: string, loc: SrcLoc): IrExpr {
  const fields: { key: IrExpr; value: IrExpr }[] = [];
  const add = (member: string, value: IrExpr): void => { fields.push({ key: strLit(member, loc), value: box(value) }); };
  for (const member of Object.keys(BUILTIN_MODULE_FNS[module] ?? {})) {
    const value = lowerer.lowerBuiltinCallableValue({ module, member }, loc);
    if (value) add(member, value);
  }
  for (const member of Object.keys(BUILTIN_MODULE_CONSTS[module] ?? {})) {
    const value = builtinModuleConstOf(lowerer, module, member);
    if (value !== undefined) add(member, builtinConstLit(value, loc));
  }
  add("posix", moduleValue(lowerer, "path/posix", loc));
  add("win32", moduleValue(lowerer, "path/win32", loc));
  return { kind: "dynObjLit", fields, type: DYN, loc };
}

export function utilTypesModuleValue(lowerer: Lowerer, loc: SrcLoc): IrExpr {
  return moduleValue(lowerer, "util/types", loc);
}

export function lowerUtilTypeValue(lowerer: Lowerer, member: string, loc: SrcLoc): IrExpr {
  const name = `%builtin.util/types.${member}`;
  if (!lowerer.builtinCallableValueFns.has(name)) {
    lowerer.builtinCallableValueFns.set(name, name);
    lowerer.liftedFns.push({ name, params: [{ localId: "value", name: "value", type: DYN }], returnType: BOOL,
      locals: [{ id: "value", name: "value", type: DYN, mutable: false }], loc,
      body: [{ kind: "return", value: { kind: "libCall", fn: "util.typeIs", args: [varRef("value", DYN, loc), strLit(member, loc)], type: BOOL, loc }, loc }],
    });
  }
  const value: IrExpr = { kind: "closure", fnName: name, captures: [], type: { kind: "func", params: [DYN], ret: BOOL }, loc };
  return { kind: "libCall", fn: "util.typeValue", args: [box(value), strLit(member, loc)], type: DYN, loc };
}

function moduleValue(lowerer: Lowerer, module: string, loc: SrcLoc): IrExpr {
  const cacheKey = `%builtin.module.get.${module}`;
  let name = lowerer.builtinCallableValueFns.get(cacheKey);
  if (!name) {
    name = cacheKey;
    lowerer.builtinCallableValueFns.set(cacheKey, name);
    const key = varRef("key", STRING, loc);
    const body: IrStmt[] = [];
    const add = (member: string, value: IrExpr): void => {
      body.push({
        kind: "if", cond: { kind: "strEq", negated: false, left: key, right: strLit(member, loc), type: BOOL, loc },
        then: [{ kind: "return", value: box(value), loc }], else_: null, loc,
      });
    };
    for (const member of Object.keys(BUILTIN_MODULE_FNS[module] ?? {})) {
      const callable = lowerer.lowerBuiltinCallableValue({ module, member }, loc);
      if (callable) add(member, callable);
    }
    for (const member of Object.keys(BUILTIN_MODULE_CONSTS[module] ?? {})) {
      const value = builtinModuleConstOf(lowerer, module, member);
      if (value !== undefined) add(member, builtinConstLit(value, loc));
    }
    if (module.startsWith("path/")) {
      add("posix", moduleValue(lowerer, "path/posix", loc));
      add("win32", moduleValue(lowerer, "path/win32", loc));
    }
    if (module === "worker_threads") {
      add("isInternalThread", { kind: "boolLit", value: false, type: BOOL, loc });
      add("parentPort", { kind: "unitLit", unit: "null", type: NULL_T, loc });
      add("workerData", { kind: "unitLit", unit: "null", type: NULL_T, loc });
    }
    body.push({ kind: "return", value: {
      kind: "libCall", fn: "process.builtinUnsupported", args: [strLit(module, loc), key], type: DYN, loc,
    }, loc });
    lowerer.liftedFns.push({
      name, params: [{ localId: "key", name: "key", type: STRING }], returnType: DYN,
      locals: [{ id: "key", name: "key", type: STRING, mutable: false }], body, loc,
    });
  }
  const getter: IrExpr = { kind: "closure", fnName: name, captures: [], type: { kind: "func", params: [STRING], ret: DYN }, loc };
  return { kind: "libCall", fn: "process.builtinModule", args: [strLit(module, loc), box(getter)], type: DYN, loc };
}

/** A first-class loader uses the same native functions as direct imports.
 * Module handles cache values and preserve aliases without a JS engine. */
export function lowerObjectAssignValue(lowerer: Lowerer, loc: SrcLoc): IrExpr {
  const name = "%builtin.Object.assign";
  if (!lowerer.liftedFns.some((fn) => fn.name === name)) lowerer.liftedFns.push({
    name, params: [{ localId: "target", name: "target", type: DYN }, { localId: "sources", name: "sources", type: DYN }],
    returnType: DYN,
    locals: [{ id: "target", name: "target", type: DYN, mutable: false }, { id: "sources", name: "sources", type: DYN, mutable: false }],
    body: [{ kind: "return", value: { kind: "libCall", fn: "dyn.assignAll", args: [varRef("target", DYN, loc), varRef("sources", DYN, loc)], type: DYN, loc }, loc }], loc,
  });
  return { kind: "closure", fnName: name, captures: [], type: { kind: "func", params: [DYN], ret: DYN, rest: true }, loc };
}

export function lowerBuiltinLoaderValue(lowerer: Lowerer, loc: SrcLoc): IrExpr {
  const cacheKey = "%builtin.process.getBuiltinModule";
  let name = lowerer.builtinCallableValueFns.get(cacheKey);
  if (!name) {
    name = cacheKey;
    lowerer.builtinCallableValueFns.set(cacheKey, name);
    const id = varRef("id", STRING, loc);
    const body: IrStmt[] = [{ kind: "varDecl", localId: "id", init: {
      kind: "libCall", fn: "process.builtinId", args: [varRef("input", DYN, loc), builtinModulesArrayLit(loc)], type: STRING, loc,
    }, loc }];
    const add = (specifier: string, value: IrExpr): void => {
      body.push({
        kind: "if", cond: { kind: "strEq", negated: false, left: id, right: strLit(specifier, loc), type: BOOL, loc },
        then: [{ kind: "return", value, loc }], else_: null, loc,
      });
    };
    add("", box({ kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc }));
    // path's default is the target platform's implementation, including identity.
    const pathModule = builtinModuleConstOf(lowerer, "path", "sep") === "\\" ? "path/win32" : "path/posix";
    add("path", moduleValue(lowerer, pathModule, loc));
    for (const module of MODULES) add(module, moduleValue(lowerer, module, loc));
    body.push({ kind: "return", value: {
      kind: "libCall", fn: "process.builtinUnsupported", args: [id, strLit("", loc)], type: DYN, loc,
    }, loc });
    lowerer.liftedFns.push({
      name, params: [{ localId: "input", name: "id", type: DYN }], returnType: DYN,
      locals: [{ id: "input", name: "id", type: DYN, mutable: false }, { id: "id", name: "module", type: STRING, mutable: false }], body, loc,
    });
  }
  return { kind: "closure", fnName: name, captures: [], type: { kind: "func", params: [DYN], ret: DYN }, loc };
}

/** `Reflect` read as a value (react-dom: `"object" === typeof Reflect && Reflect.construct`): on the native host a compiled
 * object whose members are compiled closures over the dyn object-model operations (built once, `dyn.once`); the web host
 * keeps the page's own Reflect (dyn.reflectValue decides at emission). */
export function lowerReflectValue(lowerer: Lowerer, loc: SrcLoc): IrExpr {
  const builder = "%builtin.Reflect.object";
  const un = (v: IrExpr): IrExpr => ({ kind: "dynTest", test: "undefined", value: v, type: BOOL, loc });
  const lib = (fn: IrLibFn, args: IrExpr[], type: import("../../ir/ir.js").IrType = DYN): IrExpr => ({ kind: "libCall", fn, args, type, loc });
  const p = (name: string): IrExpr => varRef(name, DYN, loc);
  const box = (e: IrExpr): IrExpr => e.type.kind === "dyn" ? e : lowerer.coerceToExpected(e, DYN);
  const members: [string, string[], (a: IrExpr[]) => IrExpr][] = [
    ["construct", ["t", "args", "nt"], a => lib("dyn.reflectConstruct", a)],
    ["apply", ["f", "self", "args"], a => lib("dyn.reflectApply", a)],
    ["ownKeys", ["t"], a => lib("dyn.ownKeys", a)],
    ["has", ["t", "k"], a => box(lib("dyn.hasKeyComputed", a, BOOL))],
    ["get", ["t", "k", "r"], a => lib("dyn.reflectGet", [a[0]!, a[1]!, { kind: "ternary", cond: un(a[2]!), then: a[0]!, else_: a[2]!, type: DYN, loc }])],
    ["set", ["t", "k", "v", "r"], a => box(lib("dyn.reflectSet", [a[0]!, a[1]!, a[2]!, { kind: "ternary", cond: un(a[3]!), then: a[0]!, else_: a[3]!, type: DYN, loc }], BOOL))],
    ["getPrototypeOf", ["t"], a => lib("dyn.getPrototype", a)],
    ["defineProperty", ["t", "k", "d"], a => box(lib("dyn.reflectDefine", a, BOOL))],
  ];
  const fields = members.map(([name, params, body]) => {
    const fnName = `%builtin.Reflect.${name}`;
    if (!lowerer.liftedFns.some((fn) => fn.name === fnName)) lowerer.liftedFns.push({
      name: fnName, params: params.map((id) => ({ localId: id, name: id, type: DYN })), returnType: DYN,
      locals: params.map((id) => ({ id, name: id, type: DYN, mutable: false })),
      body: [{ kind: "return", value: body(params.map(p)), loc }], loc,
    });
    const closure: IrExpr = { kind: "closure", fnName, captures: [], type: { kind: "func", params: params.map(() => DYN), ret: DYN }, loc };
    return { key: strLit(name, loc), value: lowerer.coerceToExpected(closure, DYN) };
  });
  if (!lowerer.liftedFns.some((fn) => fn.name === builder)) lowerer.liftedFns.push({
    name: builder, params: [], returnType: DYN, locals: [],
    body: [{ kind: "return", value: { kind: "dynObjLit", fields, type: DYN, loc }, loc }], loc,
  });
  return lib("dyn.reflectValue", [{ kind: "call", callee: builder, args: [], type: DYN, loc }]);
}

/** The native host's `Symbol` read as a value: a compiled function (`Symbol(description)` mints a unique symbol; `new Symbol` is a TypeError, the function is no
 * constructor) carrying `for`, `keyFor` and the well-known symbols (the emitter adds those). Built once by `%builtin.Symbol.ctorValue`; the web host keeps the page's. */
export const SYMBOL_CTOR_VALUE_FN = "%builtin.Symbol.ctorValue";
export function ensureSymbolCtorValue(lowerer: Lowerer, loc: SrcLoc): void {
  if (lowerer.liftedFns.some((fn) => fn.name === SYMBOL_CTOR_VALUE_FN)) return;
  const hidden = (id: string) => ({ localId: id, name: id, type: DYN });
  const p = (id: string): IrExpr => varRef(id, DYN, loc);
  const member = (name: string, display: string, params: string[], jsLength: number, body: IrExpr): IrExpr => {
    lowerer.liftedFns.push({
      name, params: params.map(hidden), returnType: DYN, jsName: display, jsLength,
      locals: params.map((id) => ({ id, name: id, type: DYN, mutable: false })), body: [{ kind: "return", value: body, loc }], loc,
    });
    return { kind: "dynFrom", value: { kind: "closure", fnName: name, captures: [], type: { kind: "func", params: params.map(() => DYN), ret: DYN }, loc }, fnName: display, type: DYN, loc };
  };
  const text = (id: string): IrExpr => ({ kind: "toString", operand: p(id), type: STRING, loc });
  const box = (e: IrExpr): IrExpr => ({ kind: "dynFrom", value: e, type: DYN, loc });
  const call = member("%builtin.Symbol.call", "Symbol", ["description"], 0, { kind: "ternary", cond: { kind: "dynTest", test: "undefined", value: p("description"), type: BOOL, loc },
    then: box({ kind: "libCall", fn: "sym.newAnon", args: [], type: SYMBOL_T, loc }), else_: box({ kind: "libCall", fn: "sym.new", args: [text("description")], type: SYMBOL_T, loc }), type: DYN, loc });
  const forFn = member("%builtin.Symbol.for", "for", ["key"], 1, box({ kind: "libCall", fn: "sym.for", args: [text("key")], type: SYMBOL_T, loc }));
  const keyType = { kind: "union" as const, unionId: lowerer.unions.intern([STRING, UNDEFINED_T]) };
  const keyForFn = member("%builtin.Symbol.keyFor", "keyFor", ["sym"], 1, lowerer.coerceToExpected({ kind: "libCall", fn: "sym.keyFor", args: [{ kind: "dynCheck", value: p("sym"), type: SYMBOL_T, loc }], type: keyType, loc }, DYN));
  lowerer.liftedFns.push({
    name: SYMBOL_CTOR_VALUE_FN, params: [], returnType: DYN, locals: [],
    body: [{ kind: "return", value: { kind: "libCall", fn: "dyn.symbolConstructorValue", args: [call, forFn, keyForFn], type: DYN, loc }, loc }], loc,
  });
}

/** The `JSON` namespace read as a value on the native host (the page's own on the web host): a compiled object holding `parse` and
 * `stringify` (the compiled serializer / parser) and Symbol.toStringTag "JSON". Built once by `%builtin.JSON.object`. */
export function lowerJsonValue(lowerer: Lowerer, loc: SrcLoc): IrExpr {
  const builder = "%builtin.JSON.object";
  const hidden = (id: string) => ({ localId: id, name: id, type: DYN });
  const p = (id: string): IrExpr => varRef(id, DYN, loc);
  const member = (name: string, params: string[], jsLength: number, body: IrExpr): IrExpr => {
    const fnName = `%builtin.JSON.object.${name}`;
    if (!lowerer.liftedFns.some((fn) => fn.name === fnName)) lowerer.liftedFns.push({
      name: fnName, params: params.map(hidden), returnType: DYN, jsName: name, jsLength,
      locals: params.map((id) => ({ id, name: id, type: DYN, mutable: false })), body: [{ kind: "return", value: body, loc }], loc,
    });
    return lowerer.coerceToExpected({ kind: "closure", fnName, captures: [], type: { kind: "func", params: params.map(() => DYN), ret: DYN }, loc }, DYN);
  };
  const text: IrExpr = { kind: "toString", operand: p("text"), type: STRING, loc };
  const parseBody: IrExpr = { kind: "ternary", cond: { kind: "dynTest", test: "function", value: p("reviver"), type: BOOL, loc },
    then: { kind: "libCall", fn: "json.parseReviver", args: [text, p("reviver")], type: DYN, loc },
    else_: { kind: "libCall", fn: "json.parse", args: [text], type: DYN, loc }, type: DYN, loc };
  const fields = [
    { key: strLit("parse", loc), value: member("parse", ["text", "reviver"], 2, parseBody) },
    { key: strLit("stringify", loc), value: member("stringify", ["value", "replacer", "space"], 3, { kind: "libCall", fn: "json.stringifyValue", args: [p("value"), p("replacer"), p("space")], type: DYN, loc }) },
  ];
  if (!lowerer.liftedFns.some((fn) => fn.name === builder)) lowerer.liftedFns.push({
    name: builder, params: [], returnType: DYN, locals: [],
    body: [{ kind: "return", value: { kind: "dynObjLit", fields, type: DYN, loc }, loc }], loc,
  });
  return { kind: "libCall", fn: "dyn.namespaceValue", args: [{ kind: "call", callee: builder, args: [], type: DYN, loc }, strLit("JSON", loc)], type: DYN, loc };
}

/** The native host's `Array` read as a value (typeof, instanceof's right side through an alias, `x.constructor`, `new Array(n)` /
 * `Array(n)` through an alias): a compiled constructor function carrying `isArray`, `from` and `of` as the same interned closures
 * direct reads of those statics answer. Built once by `%builtin.Array.ctorValue` (dyn.arrayConstructorValue); the web host keeps
 * the page's own Array. Registered for every native-host build (the emitter's inherited `constructor` of an array reads it). */
export const ARRAY_CTOR_VALUE_FN = "%builtin.Array.ctorValue";
/** `Array.of` read as a value: the interned closure over every argument (shared with the Array constructor value's `of`). */
export function lowerArrayOfValue(lowerer: Lowerer, loc: SrcLoc): IrExpr {
  return arrayVaryingFn(lowerer, "%builtin.Array.of", varRef("values", DYN, loc), "of", loc);
}
function arrayVaryingFn(lowerer: Lowerer, name: string, body: IrExpr, display: string, loc: SrcLoc): IrExpr {
  const hidden = (id: string) => ({ localId: id, name: id, type: DYN });
  const varying = { kind: "func" as const, params: [DYN], ret: DYN, rest: true as const, argumentsAll: true as const };
  if (!lowerer.liftedFns.some((fn) => fn.name === name)) lowerer.liftedFns.push({
    name, params: [hidden("first"), hidden("values")], returnType: DYN,
    locals: [{ id: "first", name: "first", type: DYN, mutable: false }, { id: "values", name: "values", type: DYN, mutable: false }],
    body: [{ kind: "return", value: body, loc }], loc, jsName: display, jsLength: display === "of" ? 0 : 1,
  });
  return { kind: "dynFrom", value: { kind: "closure", fnName: name, captures: [], type: varying, loc }, fnName: display, type: DYN, loc };
}
export function ensureArrayConstructorValue(lowerer: Lowerer, loc: SrcLoc): void {
  if (lowerer.liftedFns.some((fn) => fn.name === ARRAY_CTOR_VALUE_FN)) return;
  const of = lowerArrayOfValue(lowerer, loc);
  const isArray = lowerer.coerceToExpected(lowerArrayIsArrayValue(lowerer, loc), DYN);
  const from = lowerArrayFromValue(lowerer, loc);
  lowerer.liftedFns.push({
    name: ARRAY_CTOR_VALUE_FN, params: [], returnType: DYN, locals: [],
    body: [{ kind: "return", value: { kind: "libCall", fn: "dyn.arrayConstructorValue", args: [isArray, from, of], type: DYN, loc }, loc }], loc,
  });
}
export function lowerArrayConstructorRead(lowerer: Lowerer, loc: SrcLoc): IrExpr {
  ensureArrayConstructorValue(lowerer, loc);
  return { kind: "call", callee: ARRAY_CTOR_VALUE_FN, args: [], type: DYN, loc };
}

/** The native host's `Object` read as a value (typeof, `x.constructor`, `Object(v)` / `new Object()` through an alias): a compiled constructor
 * carrying the statics direct reads answer (the same interned closures). Built once by `%builtin.Object.ctorValue` (dyn.objectConstructorValue). */
export const OBJECT_CTOR_VALUE_FN = "%builtin.Object.ctorValue";
export function ensureObjectConstructorValue(lowerer: Lowerer, loc: SrcLoc): void {
  if (lowerer.liftedFns.some((fn) => fn.name === OBJECT_CTOR_VALUE_FN)) return;
  const names: string[] = [], values: IrExpr[] = [];
  const add = (name: string, value: IrExpr | null): void => { if (value) { names.push(name); values.push(lowerer.coerceToExpected(value, DYN)); } };
  for (const [name, fn] of Object.entries(OBJECT_CALLABLE_VALUES)) {
    if (!fn) continue;
    add(name, name === "is" ? { kind: "libCall", fn: "dyn.builtinFunction", args: [strLit("Object", loc), strLit("is", loc)], type: DYN, loc } : lowerer.lowerNativeCallableValue(fn, `Object.${name}`, loc));
  }
  add("assign", lowerObjectAssignValue(lowerer, loc));
  lowerer.liftedFns.push({
    name: OBJECT_CTOR_VALUE_FN, params: [], returnType: DYN, locals: [],
    body: [{ kind: "return", value: { kind: "libCall", fn: "dyn.objectConstructorValue", args: [
      { kind: "dynArrLit", elems: names.map((n) => lowerer.coerceToExpected(strLit(n, loc), DYN)), type: DYN, loc }, { kind: "dynArrLit", elems: values, type: DYN, loc }], type: DYN, loc }, loc }], loc,
  });
}
export function lowerObjectConstructorRead(lowerer: Lowerer, loc: SrcLoc): IrExpr {
  ensureObjectConstructorValue(lowerer, loc);
  return { kind: "call", callee: OBJECT_CTOR_VALUE_FN, args: [], type: DYN, loc };
}

/** The native host's `String` / `Number` / `Boolean` / `Function` read as values (and the `constructor` of a primitive or function): the interned coercion closures
 * (Function: a constructor that throws, no source text is compiled at run time), one per constructor so every reference is the same object. */
export const PRIMITIVE_CTOR_NAMES = ["String", "Number", "Boolean", "Function"] as const;
export const primitiveCtorValueFn = (name: string): string => `%builtin.${name}.ctorValue`;
export function ensurePrimitiveCtorValues(lowerer: Lowerer, loc: SrcLoc): void {
  const dyn = (e: IrExpr): IrExpr => lowerer.coerceToExpected(e, DYN);
  /** A static function value: `(v: dyn) => body` interned under its own name. */
  const unary = (name: string, display: string, ret: IrType, body: (v: IrExpr) => IrExpr, length = 1): IrExpr => {
    if (!lowerer.liftedFns.some((fn) => fn.name === name)) lowerer.liftedFns.push({
      name, params: [{ localId: "v", name: "v", type: DYN }], returnType: ret, locals: [{ id: "v", name: "v", type: DYN, mutable: false }],
      body: [{ kind: "return", value: body(varRef("v", DYN, loc)), loc }], loc, jsName: display, jsLength: length,
    });
    return { kind: "dynFrom", value: { kind: "closure", fnName: name, captures: [], type: { kind: "func", params: [DYN], ret }, loc }, fnName: display, type: DYN, loc };
  };
  const bool = (v: boolean): IrExpr => ({ kind: "boolLit", value: v, type: BOOL, loc });
  const statics = (names: string[], values: IrExpr[], id: string, ctor: IrExpr): IrExpr => ({ kind: "libCall", fn: "dyn.constructorStatics", args: [ctor,
    { kind: "dynArrLit", elems: names.map((n) => dyn(strLit(n, loc))), type: DYN, loc }, { kind: "dynArrLit", elems: values.map(dyn), type: DYN, loc }, strLit(id, loc)], type: DYN, loc });
  for (const name of PRIMITIVE_CTOR_NAMES) {
    const fnName = primitiveCtorValueFn(name);
    if (lowerer.liftedFns.some((fn) => fn.name === fnName)) continue;
    let value: IrExpr;
    if (name === "Function") {
      value = statics([], [], "Function", arrayVaryingFn(lowerer, "%builtin.Function.ctor", nodeThrowExpr(1, "", "The Function constructor (code from source text) is not supported", DYN, loc), "Function", loc));
    } else {
      const ctor: IrExpr = { kind: "dynFrom", value: primitiveCtorClosure(lowerer, name, loc, true), fnName: name, type: DYN, loc };
      if (name === "Number") {
        const names: string[] = [], values: IrExpr[] = [];
        for (const [member, fn] of Object.entries(NUMBER_STATIC_PREDICATES)) {
          if (!fn) continue;
          names.push(member);
          // (the ES2015 statics never coerce: a non-number is false)
          values.push(unary(`%builtin.Number.${member}`, member, BOOL, (v) => ({ kind: "ternary", cond: { kind: "dynTest", test: "number", value: v, type: BOOL, loc },
            then: { kind: "libCall", fn, args: [{ kind: "dynCheck", value: v, type: F64, loc }], type: BOOL, loc }, else_: bool(false), type: BOOL, loc })));
        }
        for (const member of ["parseFloat", "parseInt"] as const) { names.push(member); values.push(lowerNumberParserValue(lowerer, member, loc)); }
        for (const [member, constant] of Object.entries(NUMBER_CONSTANTS)) { if (constant === undefined) continue; names.push(member); values.push({ kind: "numLit", value: constant, type: F64, loc }); }
        value = statics(names, values, "Number", ctor);
      } else if (name === "String") {
        const raw = (() => {
          const fnN = "%builtin.String.raw";
          if (!lowerer.liftedFns.some((fn) => fn.name === fnN)) {
            const first = varRef("first", DYN, loc), all = varRef("values", DYN, loc), n = varRef("n", F64, loc), i = varRef("i", F64, loc), out = varRef("out", STRING, loc), rawV = varRef("raw", DYN, loc);
            const get = (v: IrExpr, key: IrExpr): IrExpr => ({ kind: "dynKeyGet", value: v, key, type: DYN, loc });
            const text = (e: IrExpr): IrExpr => ({ kind: "libCall", fn: "dyn.toStringCoerce", args: [e], type: STRING, loc });
            const num = (v: number): IrExpr => ({ kind: "numLit", value: v, type: F64, loc });
            const add = (a: IrExpr, b: IrExpr): IrExpr => ({ kind: "bin", op: "+", left: a, right: b, type: F64, loc });
            const key = (e: IrExpr): IrExpr => lowerer.coerceToExpected(e, DYN);
            const argCount: IrExpr = { kind: "dynCheck", value: get(all, strLit("length", loc)), type: F64, loc };
            lowerer.liftedFns.push({ name: fnN, params: [{ localId: "first", name: "first", type: DYN }, { localId: "values", name: "values", type: DYN }], returnType: STRING, jsName: "raw", jsLength: 1,
              locals: [{ id: "first", name: "first", type: DYN, mutable: false }, { id: "values", name: "values", type: DYN, mutable: false }, { id: "raw", name: "raw", type: DYN, mutable: false },
                { id: "n", name: "n", type: F64, mutable: false }, { id: "i", name: "i", type: F64, mutable: true }, { id: "out", name: "out", type: STRING, mutable: true }], loc,
              body: [
                { kind: "varDecl", localId: "raw", init: get(first, strLit("raw", loc)), loc },
                { kind: "varDecl", localId: "n", init: { kind: "libCall", fn: "dyn.toNumberCoerce", args: [get(rawV, strLit("length", loc))], type: F64, loc }, loc },
                { kind: "varDecl", localId: "out", init: strLit("", loc), loc },
                { kind: "varDecl", localId: "i", init: num(0), loc },
                { kind: "while", cond: { kind: "bin", op: "<", left: i, right: n, type: BOOL, loc }, loc, body: [
                  { kind: "assign", localId: "out", value: { kind: "strConcat", left: out, right: text(get(rawV, key(i))), type: STRING, loc }, loc },
                  { kind: "if", cond: { kind: "logical", op: "&&", left: { kind: "bin", op: "<", left: add(i, num(1)), right: n, type: BOOL, loc },
                      right: { kind: "bin", op: "<", left: add(i, num(1)), right: argCount, type: BOOL, loc }, type: BOOL, loc },
                    then: [{ kind: "assign", localId: "out", value: { kind: "strConcat", left: out, right: text(get(all, key(add(i, num(1))))), type: STRING, loc }, loc }], else_: null, loc },
                  { kind: "assign", localId: "i", value: add(i, num(1)), loc },
                ] },
                { kind: "return", value: out, loc },
              ] });
          }
          return { kind: "dynFrom", value: { kind: "closure", fnName: fnN, captures: [], type: { kind: "func", params: [DYN], ret: STRING, rest: true, argumentsAll: true }, loc }, fnName: "raw", type: DYN, loc } as IrExpr;
        })();
        value = statics(["fromCharCode", "fromCodePoint", "raw"], [lowerStringCodesValue(lowerer, "fromCharCode", loc), lowerStringCodesValue(lowerer, "fromCodePoint", loc), raw], "String", ctor);
      } else value = ctor;
    }
    lowerer.liftedFns.push({ name: fnName, params: [], returnType: DYN, locals: [], body: [{ kind: "return", value, loc }], loc });
  }
}
