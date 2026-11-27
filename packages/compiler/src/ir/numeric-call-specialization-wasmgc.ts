/** Direct calls that carry known numbers or booleans to `number | undefined` / `boolean | undefined` parameters, or
 * that pass undefined to a parameter with a constant default, call a variant taking the bare scalar (ported from
 * upstream scriptc a8bc0f6abf + fa65a3b385, ir/numeric-call-specialization.ts).
 *
 * The WasmGC backend keeps a parameter's ABI (optional-number.ts never unboxes parameters), so before this every such
 * call allocated a union box per optional argument and the callee read it back through a null test and a field load.
 *
 * Fork deviations from upstream:
 * - An f64 in this backend can be JS's undefined (UNDEF_NAN: an undefined union narrowed to its number arm, an
 *   unproven typed-array read), and `unionWrap` of such a number takes the undefined arm. So the variant may receive
 *   UNDEF_NAN where the original would have seen undefined: its tag tests on an f64 parameter become
 *   `num.isUndefined(p)` (upstream folds them to constants), its reads rewrap (which maps UNDEF_NAN back to
 *   undefined), and its narrowings read the f64 as the original's narrowing would (UNDEF_NAN). Boolean tests fold.
 * - Eligibility counts every string in the body equal to a selected parameter's id; anything but a union-typed
 *   varRef or an arm-typed assign/assignExpr (captures, declarations, incDec, nodes this pass does not know) keeps
 *   the function as it is.
 * - Only plain authored functions qualify: no `%`-prefixed names (class members, lifted lambdas, init and runtime
 *   helpers, which the emitter recognizes by name), no paramModes, no captures, no async/generator, not the entry.
 * - Originals are not dropped here: the emitter's own reachability pass emits only what is reached, and it already
 *   roots exports, dyn-invoked, closure-referenced, FFI and link-exported functions (a linked module's roots are not
 *   known at this point). The variant drops `ownsPrototype` (it is never a value).
 *
 * The variants share a node budget (MIN_SPECIALIZATION_BUDGET or a tenth of the module), each original body is at
 * most MAX_FUNCTION_NODES, and there is one variant per function. */
import { BOOL, F64, type IrExpr, type IrFunction, type IrModule, type IrStmt, type IrType, type IrUnionDef } from "./ir.js";
import { everyStmtList, mapExprChildren, mapStmtChildren, transformStmtList } from "./traverse.js";

const MAX_FUNCTION_NODES = 1024;
/** The variants' bodies together: at least this many nodes, or a tenth of the module's. */
const MIN_SPECIALIZATION_BUDGET = 32 * MAX_FUNCTION_NODES;

interface NumericParameter {
  index: number;
  localId: string;
  unionId: string;
  /** The tag of the number or boolean arm, and that arm's type. */
  tag: number;
  arm: IrType;
  undefinedTag: number;
  /** The constant of `param = <constant>`, when the parameter's only reads are that default's: a call that passes
   * undefined (or omits the argument) then calls the variant with the constant instead. */
  fallback: IrExpr | null;
}

function parameters(fn: IrFunction, unions: ReadonlyMap<string, IrUnionDef>, entry: string): NumericParameter[] {
  if (fn.name === entry || fn.name.startsWith("%") || fn.paramModes !== undefined) return [];
  if (fn.async || fn.generator || fn.captures !== undefined || fn.classCaptures?.length) return [];
  const result: NumericParameter[] = [];
  fn.params.forEach((param, index) => {
    if (param.type.kind !== "union") return;
    const arms = unions.get(param.type.unionId)?.arms;
    if (arms?.length !== 2) return;
    const undefinedTag = arms.findIndex((arm) => arm.kind === "undefinedT");
    const tag = arms.findIndex((arm) => arm.kind === "f64" || arm.kind === "bool");
    if (undefinedTag < 0 || tag < 0) return;
    result.push({ index, localId: param.localId, unionId: param.type.unionId, tag, arm: arms[tag]!.kind === "f64" ? F64 : BOOL, undefinedTag, fallback: null });
  });
  if (!result.length) return result;
  const selected = new Map(result.map((param) => [param.localId, param]));
  if (fn.locals.some((local) => selected.has(local.id) && (local.boxed || local.tdz))) return [];
  if (new Set(fn.params.map((p) => p.localId)).size !== fn.params.length) return [];
  const armWrite = (id: string, value: IrExpr | undefined): boolean => {
    const param = selected.get(id);
    return !param || (value?.kind === "unionWrap" && value.unionId === param.unionId && value.tag === param.tag && value.value.type.kind === param.arm.kind);
  };
  // Every mention of a selected id against the understood ones; varRef reads counted per parameter.
  const reads = new Map<string, number>();
  let mentions = 0, understood = 0, size = 0, ok = true;
  const walk = (value: unknown): void => {
    if (!ok) return;
    if (typeof value === "string") { if (selected.has(value)) mentions++; return; }
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (++size > MAX_FUNCTION_NODES) { ok = false; return; }
    const node = value as Record<string, unknown> & { kind?: string; localId?: string; type?: IrType; value?: IrExpr };
    if (typeof node.localId === "string" && selected.has(node.localId)) {
      const param = selected.get(node.localId)!;
      if (node.kind === "varRef") {
        if (node.type?.kind !== "union" || node.type.unionId !== param.unionId) { ok = false; return; }
        reads.set(node.localId, (reads.get(node.localId) ?? 0) + 1);
        understood++;
      } else if (node.kind === "assign" || node.kind === "assignExpr") {
        if (!armWrite(node.localId, node.value)) { ok = false; return; }
        understood++;
      } else { ok = false; return; }
    }
    for (const key in node) if (key !== "loc") walk(node[key]);
  };
  walk(fn.body);
  if (!ok || mentions !== understood) return [];
  // A default the lowering writes as the body's leading declarations: `x = isUndefined(param) ? <constant> :
  // narrow(param)`. When those are the parameter's only two reads, passing the constant is passing undefined.
  for (const stmt of fn.body) {
    if (stmt.kind !== "varDecl") break;
    const init = stmt.init;
    if (init?.kind !== "ternary") break;
    const { cond, then, else_ } = init;
    if (cond.kind !== "unionIsTag" || cond.negated || cond.value.kind !== "varRef") break;
    const param = selected.get(cond.value.localId);
    if (!param || cond.unionId !== param.unionId || cond.tag !== param.undefinedTag || else_.kind !== "unionNarrow" || else_.tag !== param.tag ||
      else_.value.kind !== "varRef" || else_.value.localId !== param.localId || reads.get(param.localId) !== 2 || !constantOf(then, param.arm)) break;
    param.fallback = then;
  }
  return result;
}

function constantOf(expr: IrExpr, arm: IrType): boolean {
  return arm.kind === "f64" ? expr.kind === "numLit" : expr.kind === "boolLit";
}

function specializeBody(fn: IrFunction, slots: NumericParameter[]): IrStmt[] {
  const selected = new Map(slots.map((param) => [param.localId, param]));
  return transformStmtList(fn.body, {
    stmt: (stmt) => {
      if (stmt.kind === "assign" && selected.has(stmt.localId) && stmt.value.kind === "unionWrap") return { ...stmt, value: stmt.value.value };
      return stmt;
    },
    expr: (expr) => {
      if ((expr.kind === "unionNarrow" || expr.kind === "unionIsTag") && expr.value.kind === "varRef") {
        const param = selected.get(expr.value.localId);
        if (param && expr.unionId === param.unionId) {
          const raw: IrExpr = { ...expr.value, type: param.arm };
          if (expr.kind === "unionIsTag") {
            const askUndefined = (expr.tag === param.undefinedTag) !== expr.negated;
            // A boolean is never undefined; a number may be UNDEF_NAN (see the file comment).
            if (param.arm.kind === "bool") return { kind: "boolLit", value: askUndefined ? false : true, type: BOOL, loc: expr.loc };
            const test: IrExpr = { kind: "libCall", fn: "num.isUndefined", args: [raw], type: BOOL, loc: expr.loc };
            return askUndefined ? test : { kind: "unary", op: "!", operand: test, type: BOOL, loc: expr.loc };
          }
          if (expr.tag === param.tag) return raw;
        }
      }
      if (expr.kind === "varRef") {
        const param = selected.get(expr.localId);
        if (param && expr.type.kind === "union" && expr.type.unionId === param.unionId)
          return { kind: "unionWrap", unionId: param.unionId, tag: param.tag, value: { ...expr, type: param.arm }, type: expr.type, loc: expr.loc };
      }
      if (expr.kind === "assignExpr") {
        const param = selected.get(expr.localId);
        if (param && expr.value.kind === "unionWrap")
          return { kind: "unionWrap", unionId: param.unionId, tag: param.tag, value: { ...expr, value: expr.value.value, type: param.arm }, type: expr.type, loc: expr.loc };
      }
      return expr;
    },
  });
}

/** An argument the variant takes in place of a parameter's box: the wrapped number or boolean, the default's
 * constant for an undefined, or a conditional choosing between two such arguments. */
function nativeArgument(arg: IrExpr | undefined, param: NumericParameter): IrExpr | null {
  if (arg?.kind === "ternary") {
    const then = nativeArgument(arg.then, param);
    const else_ = then && nativeArgument(arg.else_, param);
    return then && else_ ? { ...arg, then, else_, type: param.arm } : null;
  }
  if (arg?.kind !== "unionWrap" || arg.unionId !== param.unionId) return null;
  if (arg.tag === param.tag && arg.value.type.kind === param.arm.kind) return arg.value;
  if (arg.tag === param.undefinedTag && arg.value.kind === "unitLit" && param.fallback !== null) return { ...param.fallback, loc: arg.loc };
  return null;
}

function countNodes(body: IrStmt[]): number {
  let size = 0;
  everyStmtList(body, { stmt: () => { size++; return true; }, expr: () => { size++; return true; } });
  return size;
}

/** See the file comment. `symbolName` is the backend's symbol spelling, so a variant's name cannot collide after
 * mangling. Returns `mod` itself when no call changes. */
export function specializeNumericCalls(mod: IrModule, symbolName: (name: string) => string = (name) => name): IrModule {
  const unions = new Map(mod.unions?.map((union) => [union.id, union]));
  const candidates = new Map<string, { fn: IrFunction; slots: NumericParameter[] }>();
  const seen = new Set<string>(), duplicated = new Set<string>();
  for (const fn of mod.functions) { if (seen.has(fn.name)) duplicated.add(fn.name); seen.add(fn.name); }
  for (const fn of mod.functions) {
    if (duplicated.has(fn.name)) continue;
    const slots = parameters(fn, unions, mod.entry);
    if (slots.length) candidates.set(fn.name, { fn, slots });
  }
  if (!candidates.size) return mod;
  let moduleNodes = 0;
  for (const fn of mod.functions) moduleNodes += countNodes(fn.body);
  let budget = Math.max(MIN_SPECIALIZATION_BUDGET, moduleNodes / 10);
  const names = new Set(mod.functions.map((fn) => symbolName(fn.name)));
  const variants = new Map<string, IrFunction>();
  const refused = new Set<string>();
  const pending: IrFunction[] = [];
  const candidateCall = (expr: IrExpr) => {
    if (expr.kind !== "call" || refused.has(expr.callee)) return undefined;
    const candidate = candidates.get(expr.callee);
    if (!candidate || expr.args.length !== candidate.fn.params.length) return undefined;
    return candidate.slots.every((param) => nativeArgument(expr.args[param.index], param) !== null) ? candidate : undefined;
  };
  const rewriteExpr = (expr: IrExpr): IrExpr => {
    const node = mapExprChildren(expr, rewriteExpr, rewriteStmt);
    if (node.kind !== "call") return node;
    const candidate = candidateCall(node);
    if (!candidate) return node;
    const { fn, slots } = candidate;
    let variant = variants.get(fn.name);
    if (!variant) {
      const body = specializeBody(fn, slots);
      const size = countNodes(body);
      if (size > budget) { refused.add(fn.name); return node; }
      budget -= size;
      let name = `${fn.name}.nativeNumber`;
      while (names.has(symbolName(name))) name += "_";
      names.add(symbolName(name));
      const types = new Map(slots.map((param) => [param.localId, param.arm]));
      const { ownsPrototype: _ownsPrototype, ...implementation } = fn;
      variant = {
        ...implementation,
        name,
        sourceName: fn.sourceName ?? fn.name,
        params: fn.params.map((param) => { const type = types.get(param.localId); return type ? { ...param, type } : param; }),
        locals: fn.locals.map((local) => { const type = types.get(local.id); return type ? { ...local, type } : local; }),
        body,
      };
      variants.set(fn.name, variant);
      pending.push(variant);
    }
    const byIndex = new Map(slots.map((param) => [param.index, param]));
    return { ...node, callee: variant.name, args: node.args.map((arg, index) => { const param = byIndex.get(index); return param ? nativeArgument(arg, param)! : arg; }) };
  };
  const rewriteStmt = (stmt: IrStmt): IrStmt => mapStmtChildren(stmt, rewriteExpr, rewriteStmt);
  const rewriteFunction = (fn: IrFunction): IrFunction => {
    // Most bodies never call an eligible function: inspect without allocating, keep their identities.
    const unchanged = everyStmtList(fn.body, { stmt: () => true, expr: (expr) => candidateCall(expr) === undefined });
    return unchanged ? fn : { ...fn, body: fn.body.map(rewriteStmt) };
  };
  const functions = mod.functions.map(rewriteFunction);
  for (let i = 0; i < pending.length; i++) functions.push(rewriteFunction(pending[i]!));
  if (!variants.size) return functions.every((fn, i) => fn === mod.functions[i]) ? mod : { ...mod, functions };
  return { ...mod, functions };
}
