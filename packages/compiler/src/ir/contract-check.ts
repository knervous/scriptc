/* Fixed-width integer contracts (@scriptc/types, the int intrinsic library):
 * proves that every value a program stores into a slot annotated `Int32`,
 * `Uint32`, `Int8`, `Uint8`, `Int16`, `Uint16`, `Int64` or `Uint64` is a
 * value of that type, or reports the write that may not be (SC7002), or a contract it cannot check (SC7003).
 *
 * The proof is assume-guarantee: assuming every contract slot holds its type
 * (locals, globals, parameters, results and class instance fields), each
 * write must evaluate inside the type's range. Number values use the
 * integer range analysis (integer-ranges.ts) with the contract slots as its
 * facts, so a write is proven by construction (an in-range literal, a
 * bitwise result, Math.imul, a length, another slot of a narrower type, an
 * int intrinsic) or by bounded arithmetic (`i + 1` under `i < n`). Bigint
 * values are proven structurally (an in-range literal, BigInt.asIntN/asUintN
 * with width 64, a 64-bit int intrinsic, another slot of the same type).
 *
 * Proven slots of types inside the int32 range populate IrModule.contracts
 * (int32Locals, int32Params, int32Returns, int32Fields), which the backends
 * may rely on; narrow class fields are listed in narrowFields for packed
 * storage. Functions of intrinsic library modules are trusted: their
 * annotations state facts their tests establish, and are not re-proven. */
import type { IrClassDef, IrContracts, IrExpr, IrFunction, IrModule, IrStmt, SrcLoc } from "./ir.js";
import type { ScrDiagnostic } from "../diagnostics/diagnostic.js";
import { analyzeIntegerRanges, type IntegerRange, type IntegerSlotFacts } from "./integer-ranges.js";
import { exprFunctionReference } from "./function-references.js";
import { everyExprChild, everyStmtChild } from "./traverse.js";
import { intrinsicMemberName, intrinsicModule, isIntrinsicMember } from "./intrinsic-libraries.js";

export const CONTRACT_KINDS = ["Int8", "Uint8", "Int16", "Uint16", "Int32", "Uint32", "Int64", "Uint64"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];
type NumberKind = Exclude<ContractKind, "Int64" | "Uint64">;
type BigKind = "Int64" | "Uint64";

export interface ContractAnnotation {
  kind: ContractKind;
  slot: "binding" | "return" | "field";
  file: string;
  /** binding: the name's span; return: the function's span; field: the class's span. */
  start: number;
  end: number;
  name?: string;
  /** field: the field name's position. */
  at?: number;
  /** Declared in an intrinsic library module: a stated fact, not re-proven. */
  trusted: boolean;
}

export const CONTRACT_RANGES: Readonly<Record<NumberKind, IntegerRange>> = {
  Int8: { min: -128, max: 127 }, Uint8: { min: 0, max: 255 },
  Int16: { min: -32768, max: 32767 }, Uint16: { min: 0, max: 65535 },
  Int32: { min: -2147483648, max: 2147483647 }, Uint32: { min: 0, max: 4294967295 },
};
const BIG_RANGES: Readonly<Record<BigKind, [bigint, bigint]>> = {
  Int64: [-(1n << 63n), (1n << 63n) - 1n], Uint64: [0n, (1n << 64n) - 1n],
};
const DESCRIBE: Readonly<Record<ContractKind, string>> = {
  Int8: "an integer in [-128, 127]", Uint8: "an integer in [0, 255]", Int16: "an integer in [-32768, 32767]",
  Uint16: "an integer in [0, 65535]", Int32: "a signed 32-bit integer", Uint32: "an unsigned 32-bit integer",
  Int64: "a bigint in [-2^63, 2^63 - 1]", Uint64: "a bigint in [0, 2^64 - 1]",
};
const HINT: Readonly<Record<ContractKind, string>> = {
  Int8: "narrow it explicitly, for example with toInt8() from the int library ((x << 24) >> 24)",
  Uint8: "narrow it explicitly, for example `x & 0xff` or toUint8() from the int library",
  Int16: "narrow it explicitly, for example with toInt16() from the int library ((x << 16) >> 16)",
  Uint16: "narrow it explicitly, for example `x & 0xffff` or toUint16() from the int library",
  Int32: "wrap it with `| 0`, or bound it so the range is provable (a loop test, a mask)",
  Uint32: "wrap it with `>>> 0`, or bound it so the range is provable",
  Int64: "wrap it with BigInt.asIntN(64, x) or toInt64() from the int library",
  Uint64: "wrap it with BigInt.asUintN(64, x) or an int library 64-bit operation",
};
const isBig = (k: ContractKind): k is BigKind => k === "Int64" || k === "Uint64";
const within = (r: IntegerRange | null | undefined, k: NumberKind): boolean =>
  !!r && r.min >= CONTRACT_RANGES[k].min && r.max <= CONTRACT_RANGES[k].max;
/** Kinds whose every value is an int32 (the backends' int32 slot contracts). */
const INT32_KINDS: ReadonlySet<ContractKind> = new Set(["Int8", "Uint8", "Int16", "Uint16", "Int32"]);

export interface ContractCheckResult {
  diagnostics: ScrDiagnostic[];
  /** Contract facts to merge into IrModule.contracts (only when there are no diagnostics). */
  contracts: IrContracts;
  /** Proven slots by kind, for reports and tests: `local:${fn}\0${id}`, `global:${id}`, `return:${fn}`, `field:${family}`. */
  slots: Map<string, ContractKind>;
}

export function checkContracts(mod: IrModule, annotations: readonly ContractAnnotation[]): ContractCheckResult {
  const diagnostics: ScrDiagnostic[] = [];
  const slots = new Map<string, ContractKind>();
  const empty: ContractCheckResult = { diagnostics, contracts: {}, slots };
  if (annotations.length === 0) return empty;

  const bindings = new Map<string, ContractAnnotation>();
  const returns = new Map<string, ContractAnnotation>();
  const fieldsByClass = new Map<string, ContractAnnotation[]>();
  for (const a of annotations) {
    if (a.slot === "binding") bindings.set(`${a.file}\0${a.start}`, a);
    else if (a.slot === "return") returns.set(`${a.file}\0${a.start}\0${a.end}`, a);
    else {
      const key = `${a.file}\0${a.start}\0${a.end}`;
      fieldsByClass.set(key, [...(fieldsByClass.get(key) ?? []), a]);
    }
  }
  const trustedFile = new Set(annotations.filter((a) => a.trusted).map((a) => a.file));

  /* ── slots ── */
  const localKind = new Map<string, ContractKind>(); // `${fn}\0${id}`
  const globalKind = new Map<string, ContractKind>(); // global id
  const returnKind = new Map<string, ContractKind>(); // fn name
  const fieldKind = new Map<string, ContractKind>(); // family
  const declaredAt = new Map<string, SrcLoc>();
  for (const g of mod.globals ?? []) {
    const a = g.source && bindings.get(`${g.source.loc.file}\0${g.source.loc.start}`);
    if (a) { globalKind.set(g.id, a.kind); declaredAt.set(`global:${g.id}`, g.source!.loc); }
  }
  const functions = new Map(mod.functions.map((fn) => [fn.name, fn]));
  for (const fn of mod.functions) {
    for (const local of fn.locals) {
      const a = local.source && bindings.get(`${local.source.loc.file}\0${local.source.loc.start}`);
      if (a) localKind.set(`${fn.name}\0${local.id}`, a.kind);
    }
    const loc = fn.loc;
    const r = loc && returns.get(`${loc.file}\0${loc.start}\0${loc.end}`);
    if (r) returnKind.set(fn.name, r.kind);
  }
  const classes = new Map((mod.classes ?? []).map((c) => [c.name, c]));
  /** The topmost class of `className`'s chain that declares `field`: the family every subclass shares. */
  const family = (className: string, field: string): string | null => {
    let top: IrClassDef | null = null;
    for (let c = classes.get(className); c; c = c.base ? classes.get(c.base) : undefined)
      if (c.fields.some((f) => f.name === field)) top = c;
    return top ? `${top.name}\0${field}` : null;
  };
  for (const cls of classes.values()) {
    const loc = (cls as { loc?: SrcLoc }).loc;
    const fields = loc && fieldsByClass.get(`${loc.file}\0${loc.start}\0${loc.end}`);
    for (const a of fields ?? []) {
      const fam = family(cls.name, a.name!);
      if (fam) fieldKind.set(fam, a.kind);
    }
  }
  const kindOfLocal = (fnName: string, id: string): ContractKind | undefined =>
    id.startsWith("%g.") ? globalKind.get(id) : localKind.get(`${fnName}\0${id}`);
  const paramKinds = (fn: IrFunction | undefined): (ContractKind | undefined)[] =>
    fn ? fn.params.map((p) => localKind.get(`${fn.name}\0${p.localId}`)) : [];
  const hasParamContract = (fn: IrFunction | undefined) => paramKinds(fn).some((k) => k !== undefined);

  const subclasses = new Map<string, string[]>();
  for (const c of classes.values()) if (c.base) subclasses.set(c.base, [...(subclasses.get(c.base) ?? []), c.name]);
  /** The functions a virtual call of `method` on `className` can run. */
  const virtualTargets = (className: string, method: string): IrFunction[] => {
    const out: IrFunction[] = [];
    for (let c = classes.get(className); c; c = c.base ? classes.get(c.base) : undefined) {
      const f = functions.get(`%${c.name}.${method}`);
      if (f) { out.push(f); break; }
    }
    const stack = [...(subclasses.get(className) ?? [])];
    while (stack.length) {
      const name = stack.pop()!;
      const f = functions.get(`%${name}.${method}`);
      if (f) out.push(f);
      stack.push(...(subclasses.get(name) ?? []));
    }
    return out;
  };

  // Codes as upstream scriptc's contract checker numbers them: SC7002, a value not provably of the type; SC7003, a
  // contract that cannot be checked (a function with contract parameters used as a value).
  const report = (kind: ContractKind, what: string, loc: SrcLoc, code: "SC7002" | "SC7003" = "SC7002"): void => {
    diagnostics.push({
      code,
      message: `${kind} contract: ${what} is not provably ${DESCRIBE[kind]}`,
      loc,
      hint: HINT[kind],
    });
  };

  /* ── bigint values ── */
  const bigOk = (fnName: string, e: IrExpr, kind: BigKind): boolean => {
    switch (e.kind) {
      case "libCall": {
        if (e.fn === "bigint.parse" && e.args[0]?.kind === "strLit") {
          try { const v = BigInt(e.args[0].value); return v >= BIG_RANGES[kind][0] && v <= BIG_RANGES[kind][1]; } catch { return false; }
        }
        if ((e.fn === "bigint.asIntN" || e.fn === "bigint.asUintN") && e.args[0]?.kind === "numLit") {
          const n = e.args[0].value, signed = e.fn === "bigint.asIntN";
          return kind === "Int64" ? (signed ? n >= 1 && n <= 64 : n >= 0 && n <= 63) : !signed && n >= 0 && n <= 64;
        }
        // Bitwise operations keep both operands' range: a non-negative pair stays below 2^64, a signed pair in the int64
        // range (two's complement); `&` with a non-negative operand is non-negative; `>>` only moves toward zero.
        if ((e.fn === "bigint.xor" || e.fn === "bigint.or") && e.args.length === 2) return bigOk(fnName, e.args[0]!, kind) && bigOk(fnName, e.args[1]!, kind);
        if (e.fn === "bigint.and" && e.args.length === 2)
          return kind === "Uint64" ? bigOk(fnName, e.args[0]!, kind) || bigOk(fnName, e.args[1]!, kind) : bigOk(fnName, e.args[0]!, kind) && bigOk(fnName, e.args[1]!, kind);
        if (e.fn === "bigint.shr" && e.args.length === 2 && e.args[1]!.kind === "libCall" && e.args[1]!.fn === "bigint.parse" && e.args[1]!.args[0]?.kind === "strLit")
          return BigInt(e.args[1]!.args[0].value) >= 0n && bigOk(fnName, e.args[0]!, kind);
        return false;
      }
      case "varRef": return kindOfLocal(fnName, e.localId) === kind;
      case "fieldGet": { const f = family(e.className, e.field); return f !== null && fieldKind.get(f) === kind; }
      case "call": return returnKind.get(e.callee) === kind;
      case "ternary": return bigOk(fnName, e.then, kind) && bigOk(fnName, e.else_, kind);
      case "assignExpr": return bigOk(fnName, e.value, kind);
      case "upcast": case "downcast": return bigOk(fnName, e.value, kind);
      default: return false;
    }
  };

  /* The int library's counts are finer than their Int32 annotation. */
  const intLib = intrinsicModule(mod, "int");
  const countRange = (callee: string): IntegerRange | null => {
    if (!intLib || !isIntrinsicMember(intLib, callee)) return null;
    const name = intrinsicMemberName(intLib, callee);
    return /^(clz|ctz|popcnt)$/.test(name) ? { min: 0, max: 32 } : /^(clz|ctz|popcnt)64$/.test(name) ? { min: 0, max: 64 } : null;
  };

  /* ── per function ── */
  const rangeOfKind = (k: ContractKind | undefined): IntegerRange | null => (k && !isBig(k) ? CONTRACT_RANGES[k] : null);
  for (const original of mod.functions) {
    const trusted = original.loc !== undefined && trustedFile.has(original.loc.file);
    const fn = trusted ? original : withLengthBounds(original);
    const params = new Map<string, IntegerRange>();
    for (const p of fn.params) { const r = rangeOfKind(localKind.get(`${fn.name}\0${p.localId}`)); if (r) params.set(p.localId, r); }
    let ranges: ReturnType<typeof analyzeIntegerRanges> | null = null;
    const rangesOf = () => ranges ??= analyzeIntegerRanges(fn, {
      params,
      field: (cls, f) => { const fam = family(cls, f); return fam ? rangeOfKind(fieldKind.get(fam)) : null; },
      call: (callee) => callee === LENGTH ? LENGTH_RANGE : countRange(callee) ?? rangeOfKind(returnKind.get(callee)),
      // Only globals: the analysis tracks a function's own locals itself (a loop counter's bound is finer than its type).
      locals: (id) => (id.startsWith("%g.") ? rangeOfKind(globalKind.get(id)) : null),
      boxed: (id) => rangeOfKind(kindOfLocal(fn.name, id)),
    } satisfies IntegerSlotFacts);
    const valueOk = (e: IrExpr, kind: ContractKind): boolean => isBig(kind) ? bigOk(fn.name, e, kind) : within(rangesOf().get(e), kind);
    const check = (kind: ContractKind | undefined, value: IrExpr | null, what: string, loc: SrcLoc): void => {
      if (!kind || value === null || trusted) return;
      if (!valueOk(value, kind)) report(kind, what, value.loc ?? loc);
    };
    const stepOk = (e: IrExpr & { prefix: boolean; op: "+" | "-" }, kind: NumberKind): boolean => {
      const r = rangesOf().get(e);
      if (!r) return false;
      const d = e.op === "+" ? 1 : -1;
      return within(e.prefix ? r : { min: r.min + d, max: r.max + d }, kind);
    };
    const expr = (e: IrExpr): boolean => {
      switch (e.kind) {
        case "assignExpr": check(kindOfLocal(fn.name, e.localId), e.value, `the value assigned to '${e.localId.replace(/\.\d+$/, "")}'`, e.loc); break;
        case "incDec": {
          const k = kindOfLocal(fn.name, e.localId);
          if (k && !trusted && (isBig(k) || !stepOk(e, k))) report(k, `the ${e.op === "+" ? "increment" : "decrement"} of '${e.localId.replace(/\.\d+$/, "")}'`, e.loc);
          break;
        }
        case "fieldIncDec": {
          const fam = family(e.className, e.field), k = fam ? fieldKind.get(fam) : undefined;
          if (k && !trusted && (isBig(k) || !stepOk(e, k))) report(k, `the ${e.op === "+" ? "increment" : "decrement"} of field '${e.field}'`, e.loc);
          break;
        }
        case "call": {
          const kinds = paramKinds(functions.get(e.callee));
          kinds.forEach((k, i) => {
            if (!k) return;
            if (i >= e.args.length) { if (!trusted) report(k, `the missing argument ${i + 1} of ${e.callee}`, e.loc); }
            else check(k, e.args[i]!, `argument ${i + 1} of ${displayName(e.callee)}`, e.loc);
          });
          break;
        }
        case "virtualCall":
          for (const target of virtualTargets(e.className, e.method))
            paramKinds(target).forEach((k, i) => { if (k && i < e.args.length) check(k, e.args[i]!, `argument ${i} of ${e.method}()`, e.loc); });
          break;
        case "new": {
          const kinds = paramKinds(functions.get(`%${e.className}.constructor`));
          kinds.forEach((k, i) => { if (k && i >= 1 && i - 1 < e.args.length) check(k, e.args[i - 1]!, `constructor argument ${i}`, e.loc); });
          break;
        }
        default: {
          const referenced = exprFunctionReference(e);
          if (referenced !== undefined && hasParamContract(functions.get(referenced)) && !trusted) {
            const k = paramKinds(functions.get(referenced)).find((x) => x !== undefined)!;
            report(k, "a parameter of a function used as a value (its callers cannot be checked; call it directly)", e.loc, "SC7003");
          }
        }
      }
      return everyExprChild(e, expr, stmt);
    };
    const fieldWrite = (s: { className: string; field: string; value: IrExpr; loc: SrcLoc }): void => {
      const fam = family(s.className, s.field);
      check(fam ? fieldKind.get(fam) : undefined, s.value, `the value stored into field '${s.field}'`, s.loc);
    };
    const stmt = (s: IrStmt): boolean => {
      switch (s.kind) {
        case "varDecl": check(kindOfLocal(fn.name, s.localId), s.init, `the initial value of '${s.localId.replace(/\.\d+$/, "")}'`, s.loc); break;
        case "assign": check(kindOfLocal(fn.name, s.localId), s.value, `${s.initializes ? "the initial value of" : "the value assigned to"} '${s.localId.replace(/^%g\.[a-z]\./, "").replace(/\.\d+$/, "")}'`, s.loc); break;
        case "fieldSet": fieldWrite(s); break;
        case "return": if (!fn.async && !fn.generator) check(returnKind.get(fn.name), s.value, `the value ${displayName(fn.name)} returns`, s.loc); break;
      }
      return everyStmtChild(s, expr, stmt);
    };
    for (const s of fn.body) stmt(s);
  }

  /* ── facts ── */
  if (diagnostics.length) return empty;
  const contracts: IrContracts = {};
  const int32Locals: string[] = [], int32Params: string[] = [], int32Returns: string[] = [], int32Fields: string[] = [], narrowFields: string[] = [];
  for (const [key, k] of localKind) {
    slots.set(`local:${key}`, k);
    if (INT32_KINDS.has(k)) int32Locals.push(key);
  }
  for (const fn of mod.functions)
    for (const p of fn.params) { const k = localKind.get(`${fn.name}\0${p.localId}`); if (k && INT32_KINDS.has(k)) int32Params.push(`${fn.name}\0${p.localId}`); }
  for (const [id, k] of globalKind) { slots.set(`global:${id}`, k); if (INT32_KINDS.has(k)) int32Locals.push(`\0${id}`); }
  for (const [fnName, k] of returnKind) { slots.set(`return:${fnName}`, k); if (INT32_KINDS.has(k)) int32Returns.push(fnName); }
  for (const [fam, k] of fieldKind) {
    slots.set(`field:${fam}`, k);
    if (INT32_KINDS.has(k)) int32Fields.push(fam);
    if (k !== "Int32") narrowFields.push(`${fam}\0${k}`);
  }
  if (int32Locals.length) contracts.int32Locals = int32Locals.sort();
  if (int32Params.length) contracts.int32Params = int32Params.sort();
  if (int32Returns.length) contracts.int32Returns = int32Returns.sort();
  if (int32Fields.length) contracts.int32Fields = int32Fields.sort();
  if (narrowFields.length) contracts.narrowFields = narrowFields.sort();
  return { diagnostics, contracts, slots };
}

/* A string, array or typed array length is an int32 in compiled code (every
 * representation stores it in 32 signed bits), and @scriptc/types documents
 * it as one. The range analysis bounds lengths as uint32, so the checker
 * analyses a copy of each function in which every length read is a call of
 * LENGTH (its receiver kept as the argument, so evaluation is unchanged),
 * whose result the facts bound to [0, 2^31 - 1]. */
const LENGTH = "%contract.length";
const LENGTH_RANGE: IntegerRange = { min: 0, max: 2147483647 };
function withLengthBounds(fn: IrFunction): IrFunction {
  const swap = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(swap);
    if (!v || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    if (typeof o.kind === "string" && o.kind.endsWith("Intrinsic") && o.method === "length" && Array.isArray(o.args) && o.args.length === 0 && o.receiver)
      return { kind: "call", callee: LENGTH, args: [swap(o.receiver)], type: o.type, loc: o.loc };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = k === "loc" || k === "type" || k === "source" ? o[k] : swap(o[k]);
    return out;
  };
  return { ...fn, body: swap(fn.body) as IrStmt[] };
}

/** `%%m0.Cursor.advance` → `Cursor.advance`, `%m1.hash` → `hash`. */
function displayName(fnName: string): string {
  return fnName.replace(/^%+(?:m\d+\.)?/, "").replace(/^%/, "");
}

/** Merges checked facts into a module's contracts. */
export function withContracts(mod: IrModule, facts: IrContracts): void {
  if (Object.keys(facts).length === 0) return;
  const into: IrContracts = mod.contracts ?? {};
  for (const [k, v] of Object.entries(facts) as [keyof IrContracts, string[]][])
    (into as Record<string, string[]>)[k] = [...new Set([...((into as Record<string, string[] | undefined>)[k] ?? []), ...v])].sort();
  mod.contracts = into;
}
