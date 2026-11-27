import { expect, test } from "vitest";
import {
  BOOL,
  DYN,
  F64,
  JSWORD,
  STRING,
  VOID,
  type IrExpr,
  type IrFunction,
  type IrModule,
  type IrStmt,
} from "./ir.js";
import { promoteJswords } from "./jsword.js";
import { assignLegacyTiers } from "./tiers.js";
import { validateModule } from "./validate.js";

const loc = { file: "jsword.ts", start: 0, end: 0 };
const ref = (id: string, type = DYN): IrExpr => ({ kind: "varRef", localId: id, type, loc });
const num = (value: number): IrExpr => ({
  kind: "dynFrom",
  value: { kind: "numLit", value, type: F64, loc },
  type: DYN,
  loc,
});
const op = (fn: "dyn.add" | "dyn.arithmetic", l: IrExpr, r: IrExpr, symbol?: string): IrExpr => ({
  kind: "libCall",
  fn,
  args:
    symbol === undefined ? [l, r] : [l, r, { kind: "strLit", value: symbol, type: STRING, loc }],
  type: DYN,
  loc,
});
const keyGet = (from: IrExpr, key: string): IrExpr => ({
  kind: "dynKeyGet",
  key: { kind: "strLit", value: key, type: STRING, loc },
  value: from,
  type: DYN,
  loc,
});

function fn(name: string, body: IrStmt[], locals: string[] = [], returnType = DYN): IrFunction {
  return {
    name,
    params: [{ localId: "o", name: "o", type: DYN }],
    returnType,
    locals: [
      { id: "o", name: "o", type: DYN, mutable: false },
      ...locals.map((id) => ({ id, name: id, type: DYN, mutable: true })),
    ],
    body,
    loc,
  };
}

function moduleOf(...functions: IrFunction[]): IrModule {
  const main: IrFunction = {
    name: "%main",
    params: [],
    returnType: VOID,
    locals: [],
    body: [],
    loc,
  };
  const mod: IrModule = {
    irVersion: 17,
    sourceFile: "jsword.ts",
    functions: [main, ...functions],
    entry: "%main",
  };
  assignLegacyTiers(mod.functions);
  return mod;
}

/** The js.* calls of a body, in source order. */
function jsCalls(body: IrStmt[]): string[] {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === "object") {
      const node = value as { kind?: string; fn?: string };
      if (node.kind === "libCall" && node.fn?.startsWith("js.")) out.push(node.fn);
      Object.values(value).forEach(visit);
    }
  };
  visit(body);
  return out;
}

test("operator chains compute with jswords and box only where a dyn value is needed", () => {
  // return o.x * o.y + 1
  const chain = fn("chain", [
    {
      kind: "return",
      value: op(
        "dyn.add",
        op("dyn.arithmetic", keyGet(ref("o"), "x"), keyGet(ref("o"), "y"), "*"),
        num(1),
      ),
      loc,
    },
  ]);
  const mod = moduleOf(chain);
  expect(chain.tier).toBe("dynamic");
  // A static caller keeps the dyn ABI: one box at the end of the chain,
  // none in between; the static 1 is an immediate and the reads keep their
  // cells.
  const caller = fn("caller", [
    {
      kind: "return",
      value: { kind: "call", callee: "chain", args: [ref("o")], type: DYN, loc },
      loc,
    },
  ]);
  mod.functions.push(caller);
  expect(caller.tier).toBeUndefined();
  expect(promoteJswords(mod)).toBe(1);
  expect(chain.returnType).toEqual(DYN);
  expect(jsCalls(chain.body)).toEqual([
    "js.toDyn",
    "js.add",
    "js.arithmetic",
    "js.fromDyn",
    "js.fromDyn",
    "js.fromF64",
  ]);
  expect(jsCalls(caller.body)).toEqual([]);
  expect(validateModule(mod)).toEqual([]);
});

test("a dynamic function called only by dynamic functions returns a jsword", () => {
  const twice = fn("twice", [
    { kind: "return", value: op("dyn.arithmetic", keyGet(ref("o"), "n"), num(2), "*"), loc },
  ]);
  // return twice(o) + twice(o): no box between the calls and the add.
  const sum = fn("sum", [
    {
      kind: "return",
      value: op(
        "dyn.add",
        { kind: "call", callee: "twice", args: [ref("o")], type: DYN, loc },
        { kind: "call", callee: "twice", args: [ref("o")], type: DYN, loc },
      ),
      loc,
    },
  ]);
  const user = fn("user", [
    {
      kind: "exprStmt",
      expr: keyGet({ kind: "call", callee: "sum", args: [ref("o")], type: DYN, loc }, "x"),
      loc,
    },
    { kind: "return", value: ref("o"), loc },
  ]);
  const mod = moduleOf(twice, sum, user);
  promoteJswords(mod);
  expect(twice.returnType).toEqual(JSWORD);
  expect(sum.returnType).toEqual(JSWORD);
  expect(jsCalls(twice.body)).toEqual(["js.arithmetic", "js.fromDyn", "js.fromF64"]);
  expect(jsCalls(sum.body)).toEqual(["js.add"]);
  // A dyn consumer boxes the jsword result once.
  expect(jsCalls(user.body)).toEqual(["js.toDyn", "js.fromDyn"]);
  expect(validateModule(mod)).toEqual([]);
});

test("a number check of an operator result reads the jsword, and comparisons take jswords", () => {
  const checked = fn(
    "checked",
    [
      {
        kind: "if",
        cond: {
          kind: "libCall",
          fn: "dyn.compare",
          args: [keyGet(ref("o"), "a"), num(3), { kind: "strLit", value: "<", type: STRING, loc }],
          type: BOOL,
          loc,
        },
        then: [{ kind: "return", value: { kind: "numLit", value: 0, type: F64, loc }, loc }],
        else_: null,
        loc,
      },
      {
        kind: "return",
        value: {
          kind: "dynCheck",
          value: op("dyn.arithmetic", keyGet(ref("o"), "a"), num(2), "%"),
          type: F64,
          loc,
        },
        loc,
      },
    ],
    [],
    F64,
  );
  const mod = moduleOf(checked);
  promoteJswords(mod);
  expect(jsCalls(checked.body)).toEqual([
    "js.compare",
    "js.fromDyn",
    "js.fromF64",
    "js.toF64",
    "js.arithmetic",
    "js.fromDyn",
    "js.fromF64",
  ]);
  expect(validateModule(mod)).toEqual([]);
});

test("a dyn local written by operators in a loop becomes a jsword local", () => {
  // acc = o.start; for (...) acc = acc + o.step; return acc
  const loop = fn(
    "loop",
    [
      { kind: "varDecl", localId: "acc", init: keyGet(ref("o"), "start"), loc },
      {
        kind: "while",
        cond: { kind: "boolLit", value: false, type: BOOL, loc },
        body: [
          {
            kind: "assign",
            localId: "acc",
            value: op("dyn.add", ref("acc"), keyGet(ref("o"), "step")),
            loc,
          },
        ],
        loc,
      },
      { kind: "return", value: ref("acc"), loc },
    ],
    ["acc"],
  );
  const mod = moduleOf(loop);
  promoteJswords(mod);
  expect(loop.locals.find((l) => l.id === "acc")!.type).toEqual(JSWORD);
  expect(loop.returnType).toEqual(JSWORD);
  expect(jsCalls(loop.body)).toEqual(["js.fromDyn", "js.add", "js.fromDyn"]);
  expect(validateModule(mod)).toEqual([]);
});

test("a dyn local mostly read by dyn consumers stays dyn", () => {
  // t = o.a + 1; for (...) use(t)
  const reader = fn(
    "reader",
    [
      { kind: "varDecl", localId: "t", init: op("dyn.add", keyGet(ref("o"), "a"), num(1)), loc },
      {
        kind: "while",
        cond: { kind: "boolLit", value: false, type: BOOL, loc },
        body: [{ kind: "exprStmt", expr: keyGet(ref("t"), "x"), loc }],
        loc,
      },
      { kind: "return", value: ref("t"), loc },
    ],
    ["t"],
  );
  const mod = moduleOf(reader);
  promoteJswords(mod);
  expect(reader.locals.find((l) => l.id === "t")!.type).toEqual(DYN);
  expect(validateModule(mod)).toEqual([]);
});

test("static functions keep their dyn values; async functions keep their dyn result", () => {
  const plain = fn("plain", [{ kind: "return", value: ref("o"), loc }]);
  const asyncChain = fn("asyncChain", [
    { kind: "return", value: op("dyn.add", keyGet(ref("o"), "x"), num(1)), loc },
  ]);
  asyncChain.async = true;
  const mod = moduleOf(plain, asyncChain);
  expect(plain.tier).toBeUndefined();
  expect(asyncChain.tier).toBe("dynamic");
  const before = JSON.stringify(plain);
  expect(promoteJswords(mod)).toBe(1);
  expect(JSON.stringify(plain)).toBe(before);
  expect(asyncChain.returnType).toEqual(DYN);
  expect(jsCalls(asyncChain.body)).toEqual(["js.toDyn", "js.add", "js.fromDyn", "js.fromF64"]);
  expect(validateModule(mod)).toEqual([]);
});

const call = (callee: string, ...args: IrExpr[]): IrExpr => ({
  kind: "call",
  callee,
  args,
  type: DYN,
  loc,
});

test("a parameter that callers pass numbers and operator results takes a jsword", () => {
  // scale(o) { return o * 2 }
  const scale = fn("scale", [
    { kind: "return", value: op("dyn.arithmetic", ref("o"), num(2), "*"), loc },
  ]);
  // return scale(1.5) + scale(o.n + 1)
  const caller = fn("caller", [
    {
      kind: "return",
      value: op(
        "dyn.add",
        call("scale", num(1.5)),
        call("scale", op("dyn.add", keyGet(ref("o"), "n"), num(1))),
      ),
      loc,
    },
  ]);
  const mod = moduleOf(scale, caller);
  promoteJswords(mod);
  expect(scale.params[0]!.type).toEqual(JSWORD);
  expect(scale.locals.find((l) => l.id === "o")!.type).toEqual(JSWORD);
  // The parameter is the operand itself: no conversion in the callee.
  expect(jsCalls(scale.body)).toEqual(["js.arithmetic", "js.fromF64"]);
  // The callers pass an immediate and an operator result: no box.
  expect(jsCalls(caller.body)).not.toContain("js.toDyn");
  expect(jsCalls(caller.body).filter((f) => f === "js.fromF64")).toHaveLength(2);
  expect(validateModule(mod)).toEqual([]);
});

test("a parameter read by dyn consumers or passed cells keeps the dyn ABI", () => {
  // keyed(o) { o.y; return o.x }: both reads need a cell, so a jsword would
  // box twice where the caller boxes once.
  const keyed = fn("keyed", [
    { kind: "exprStmt", expr: keyGet(ref("o"), "y"), loc },
    { kind: "return", value: keyGet(ref("o"), "x"), loc },
  ]);
  // half(o) { return o / 2 }, called with property reads only.
  const half = fn("half", [
    { kind: "return", value: op("dyn.arithmetic", ref("o"), num(2), "/"), loc },
  ]);
  // twice(o) { return o * 2 }, also called by a static function.
  const twice = fn("twice", [
    { kind: "return", value: op("dyn.arithmetic", ref("o"), num(2), "*"), loc },
  ]);
  const caller = fn("caller", [
    { kind: "exprStmt", expr: call("keyed", num(1)), loc },
    { kind: "exprStmt", expr: call("half", keyGet(ref("o"), "n")), loc },
    { kind: "return", value: op("dyn.add", call("twice", num(3)), num(1)), loc },
  ]);
  const staticCaller = fn("staticCaller", [
    { kind: "exprStmt", expr: call("twice", ref("o")), loc },
    { kind: "return", value: ref("o"), loc },
  ]);
  const mod = moduleOf(keyed, half, twice, caller, staticCaller);
  expect(staticCaller.tier).toBeUndefined();
  promoteJswords(mod);
  expect(keyed.params[0]!.type).toEqual(DYN);
  expect(half.params[0]!.type).toEqual(DYN);
  expect(twice.params[0]!.type).toEqual(DYN);
  expect(twice.returnType).toEqual(DYN);
  expect(validateModule(mod)).toEqual([]);
});

/** `for (...) %g.sum = %g.sum + o.step` in a dynamic function. */
function globalLoop(name: string, global: string): IrFunction {
  return fn(name, [
    {
      kind: "while",
      cond: { kind: "boolLit", value: false, type: BOOL, loc },
      body: [
        {
          kind: "assign",
          localId: global,
          value: op("dyn.add", ref(global), keyGet(ref("o"), "step")),
          loc,
        },
      ],
      loc,
    },
    { kind: "return", value: ref("o"), loc },
  ]);
}

test("a dyn module global written by operators in a loop becomes a jsword global", () => {
  const loop = globalLoop("loop", "%g.e.sum");
  // %g.sum.x, once: a dyn consumer.
  const report = fn("report", [
    { kind: "exprStmt", expr: keyGet(ref("%g.e.sum"), "x"), loc },
    { kind: "return", value: ref("o"), loc },
  ]);
  const mod = moduleOf(loop, report);
  mod.globals = [{ id: "%g.e.sum", name: "sum", type: DYN, mutable: true }];
  promoteJswords(mod);
  expect(mod.globals[0]!.type).toEqual(JSWORD);
  // The loop's own result (o, a jsword result) is the second js.fromDyn.
  expect(jsCalls(loop.body)).toEqual(["js.add", "js.fromDyn", "js.fromDyn"]);
  // One box for the read; the second call is the jsword result o.
  expect(jsCalls(report.body)).toEqual(["js.toDyn", "js.fromDyn"]);
  expect(validateModule(mod)).toEqual([]);
});

test("a module global a static function reads stays dyn", () => {
  const loop = globalLoop("loop", "%g.e.sum");
  const reader: IrFunction = {
    name: "reader",
    params: [],
    returnType: DYN,
    locals: [],
    body: [{ kind: "return", value: ref("%g.e.sum"), loc }],
    loc,
  };
  const mod = moduleOf(loop, reader);
  expect(reader.tier).toBeUndefined();
  mod.globals = [{ id: "%g.e.sum", name: "sum", type: DYN, mutable: true }];
  promoteJswords(mod);
  expect(mod.globals[0]!.type).toEqual(DYN);
  expect(jsCalls(loop.body)).toEqual([
    "js.toDyn",
    "js.add",
    "js.fromDyn",
    "js.fromDyn",
    "js.fromDyn",
  ]);
  expect(validateModule(mod)).toEqual([]);
});

test("a class member that dynamic code calls directly gets a jsword entry", () => {
  // %Counter.scale(o) { return o * 2 }: vtables and the runtime reach the
  // member by name, so it keeps the dyn ABI as a wrapper.
  const member = fn("%Counter.scale", [
    { kind: "return", value: op("dyn.arithmetic", ref("o"), num(2), "*"), loc },
  ]);
  member.sourceName = "scale";
  const caller = fn("caller", [
    { kind: "return", value: op("dyn.add", call("%Counter.scale", num(1.5)), num(1)), loc },
  ]);
  const staticCaller = fn("staticCaller", [
    { kind: "exprStmt", expr: call("%Counter.scale", ref("o")), loc },
    { kind: "return", value: ref("o"), loc },
  ]);
  const mod = moduleOf(member, caller, staticCaller);
  promoteJswords(mod);
  const entry = mod.functions.find((f) => f.name === "%js.%Counter.scale")!;
  expect(entry.params[0]!.type).toEqual(JSWORD);
  expect(entry.returnType).toEqual(JSWORD);
  expect(entry.sourceName).toBe("scale");
  expect(jsCalls(entry.body)).toEqual(["js.arithmetic", "js.fromF64"]);
  // The member forwards its cell and boxes the entry's result.
  expect(member.params[0]!.type).toEqual(DYN);
  expect(member.returnType).toEqual(DYN);
  expect(member.sourceName).toBeUndefined();
  expect(member.body).toHaveLength(1);
  expect(jsCalls(member.body)).toEqual(["js.toDyn", "js.fromDyn"]);
  // Dynamic callers call the entry; static callers keep the member.
  expect(JSON.stringify(caller.body)).toContain('"callee":"%js.%Counter.scale"');
  expect(JSON.stringify(staticCaller.body)).toContain('"callee":"%Counter.scale"');
  expect(validateModule(mod)).toEqual([]);
});

test("a closure boxed into a function value gets a jsword body, and dynamic calls pass jswords", () => {
  // %fn.add(o) { return o + 1 }, boxed by a dynamic function and called
  // through dynInvoke with an operator result.
  const closure = fn("%fn.add", [{ kind: "return", value: op("dyn.add", ref("o"), num(1)), loc }]);
  closure.captures = [];
  // %fn.read(o) { return o.x }: a property read needs the cell.
  const reader = fn("%fn.read", [{ kind: "return", value: keyGet(ref("o"), "x"), loc }]);
  reader.captures = [];
  const funcType = { kind: "func" as const, params: [DYN], ret: DYN };
  const box = (name: string): IrExpr => ({
    kind: "dynFrom",
    value: { kind: "closure", fnName: name, captures: [], type: funcType, loc },
    type: DYN,
    loc,
  });
  const user = fn("user", [
    { kind: "exprStmt", expr: box("%fn.add"), loc },
    { kind: "exprStmt", expr: box("%fn.read"), loc },
    {
      kind: "return",
      value: {
        kind: "dynInvoke",
        recv: ref("o"),
        method: "add",
        calleeName: "o.add",
        args: [op("dyn.add", keyGet(ref("o"), "n"), num(1)), ref("o")],
        type: DYN,
        loc,
      },
      loc,
    },
  ]);
  const mod = moduleOf(closure, reader, user);
  promoteJswords(mod);
  expect(closure.jsEntry).toBe("%js.%fn.add");
  expect(reader.jsEntry).toBeUndefined();
  const entry = mod.functions.find((f) => f.name === "%js.%fn.add")!;
  expect(entry.captures).toEqual([]);
  expect(entry.params[0]!.type).toEqual(JSWORD);
  expect(entry.returnType).toEqual(JSWORD);
  // The closure keeps its dyn body for every other caller.
  expect(closure.params[0]!.type).toEqual(DYN);
  expect(closure.returnType).toEqual(DYN);
  // The operator result crosses unboxed; the cell argument stays dyn.
  let invoke: Extract<IrExpr, { kind: "dynInvoke" }> | undefined;
  const find = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(find);
    else if (value !== null && typeof value === "object") {
      if ((value as IrExpr).kind === "dynInvoke") invoke = value as typeof invoke;
      Object.values(value).forEach(find);
    }
  };
  find(user.body);
  expect(invoke!.args.map((a) => a.type.kind)).toEqual(["jsword", "dyn"]);
  expect(validateModule(mod)).toEqual([]);
});
