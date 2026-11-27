// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import { keyedHelperName } from "./stable-names.js";
import { BOOL, DYN, STRING, dynHoldable, funcOf, typeEquals, typeKey, type IrExpr, type IrFunction, type IrStmt, type IrType } from "../../ir/ir.js";
import { varRef } from "../../ir/build.js";
import { everyStmtList, transformStmtList } from "../../ir/traverse.js";
import { genResultRecord } from "../type-mapper.js";
import { dynUndefinedExpr, type Lowerer } from "./lowerer.js";

type GeneratorType = Extract<IrType, { kind: "generator" }>;
type Invoke = Extract<IrExpr, { kind: "dynInvoke" }>;

/** An untyped consumer resumes the original native fiber. The capsule's
 * exact type key selects the channel conversions and result layout. */
export class GeneratorDynamicDispatch {
  private readonly generators = new Map<string, GeneratorType>();
  private readonly dispatches = new Map<string, { fn: IrFunction; source: Invoke; types: Set<string> }>();
  private readonly generated = new Set<IrFunction>();
  private readonly properties = new Map<string, { fn: IrFunction; types: Set<string> }>();

  process(lowerer: Lowerer, functions: readonly IrFunction[], classHelpers: ReadonlySet<IrFunction>): boolean {
    const seen = new Set<string>();
    const rewrite = new Set<IrFunction>();
    const discover = (type: IrType): void => {
      const key = typeKey(type);
      if (seen.has(key)) return;
      seen.add(key);
      if (type.kind === "generator") this.generators.set(key, type);
      else if (type.kind === "func") discover(type.ret);
      else if (type.kind === "promise") discover(type.inner);
      else if (type.kind === "array") discover(type.elem);
      else if (type.kind === "record") lowerer.shapes.get(type.shapeId)?.fields.forEach((field) => discover(field.type));
      else if (type.kind === "union") lowerer.unions.get(type.unionId)?.arms.forEach(discover);
    };
    for (const fn of functions) everyStmtList(fn.body, { stmt: () => true, expr: (expr) => {
      if (expr.kind === "dynFrom") discover(expr.value.type);
      if (expr.kind === "dynInvoke" && ["next", "return", "throw"].includes(expr.method)) rewrite.add(fn);
      if (expr.kind === "dynKeyGet" && expr.key.kind === "strLit" && ["next", "return", "throw"].includes(expr.key.value)) rewrite.add(fn);
      return true;
    } });
    let changed = false;
    for (const fn of functions) {
      // The generator helper's fallback may itself dispatch native classes.
      // Its class helper must retain the runtime fallback, not route back
      // to the generator helper and form an indirect recursion cycle.
      if (this.generated.has(fn) || classHelpers.has(fn) || !rewrite.has(fn)) continue;
      fn.body = transformStmtList(fn.body, { stmt: (stmt) => stmt, expr: (expr) => {
        if (expr.kind === "dynKeyGet" && expr.key.kind === "strLit" && ["next", "return", "throw"].includes(expr.key.value)) {
          const method = expr.key.value;
          let property = this.properties.get(method);
          if (!property) {
            const loc = expr.loc;
            const fn: IrFunction = { name: `%dyn.generator.get.${method}`,
              params: [{ localId: "value", name: "value", type: DYN }], returnType: DYN,
              locals: [{ id: "value", name: "value", type: DYN, mutable: false }],
              body: [{ kind: "return", value: { ...expr, value: varRef("value", DYN, loc) }, loc }], loc };
            property = { fn, types: new Set() };
            this.properties.set(method, property);
            this.generated.add(fn);
            lowerer.liftedFns.push(fn);
            lowerer.shareHelper(fn);
            lowerer.shareHelper(`%dyn.generator.method.${method}`);
            lowerer.liftedFns.push({ name: `%dyn.generator.method.${method}`,
              params: [{ localId: "arg", name: "arg", type: DYN }], returnType: DYN,
              locals: [{ id: "arg", name: "arg", type: DYN, mutable: false }],
              body: [{ kind: "return", value: { kind: "dynInvoke", method, calleeName: `Generator.${method}`,
                recv: { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc },
                args: [varRef("arg", DYN, loc)], type: DYN, loc }, loc }], loc });
            changed = true;
          }
          return { kind: "call", callee: property.fn.name, args: [expr.value], type: DYN, loc: expr.loc };
        }
        if (expr.kind !== "dynInvoke" || !["next", "return", "throw"].includes(expr.method)) return expr;
        const key = JSON.stringify([expr.method, expr.args.length, expr.calleeName]);
        let dispatch = this.dispatches.get(key);
        if (!dispatch) {
          const loc = expr.loc;
          const params = [expr.recv, ...expr.args].map((_, i) => ({ localId: `p.${i}`, name: `p${i}`, type: DYN }));
          const helper: IrFunction = {
            name: keyedHelperName(lowerer, "%dyn.generator.call", key), params, returnType: DYN,
            locals: params.map((p) => ({ id: p.localId, name: p.name, type: DYN, mutable: false })),
            body: [{ kind: "return", value: { ...expr, recv: varRef("p.0", DYN, loc), args: expr.args.map((_, i) => varRef(`p.${i + 1}`, DYN, loc)) }, loc }], loc,
          };
          dispatch = { fn: helper, source: expr, types: new Set() };
          this.dispatches.set(key, dispatch);
          this.generated.add(helper);
          lowerer.liftedFns.push(helper);
          lowerer.shareHelper(helper);
          changed = true;
        }
        return { kind: "call", callee: dispatch.fn.name, args: [expr.recv, ...expr.args], type: DYN, loc: expr.loc };
      } });
    }
    for (const [method, property] of this.properties) for (const [key] of this.generators) {
      if (property.types.has(key)) continue;
      property.types.add(key);
      const loc = property.fn.loc;
      property.fn.body.unshift({ kind: "if", cond: { kind: "libCall", fn: "dyn.typedRefIs",
        args: [varRef("value", DYN, loc), { kind: "strLit", value: key, type: STRING, loc }], type: BOOL, loc },
        then: [{ kind: "return", value: { kind: "dynFrom", value: { kind: "closure", fnName: `%dyn.generator.method.${method}`,
          captures: [], type: funcOf([DYN], DYN), loc }, type: DYN, loc }, loc }], else_: null, loc });
      changed = true;
    }
    for (const dispatch of this.dispatches.values()) for (const [key, type] of this.generators) {
      if (dispatch.types.has(key)) continue;
      dispatch.types.add(key);
      const loc = dispatch.fn.loc;
      const receiver = varRef("p.0", DYN, loc);
      const mode = dispatch.source.method as "next" | "return" | "throw";
      // return(v) on a generator whose return channel is void: the value has no typed slot, so this resume's result is the
      // dyn-valued record ({ value: v, done: true }; the yielded value when a finally block yields).
      const carried = mode === "return" && type.retT.kind === "void" && !type.async && dispatch.source.args.length > 0;
      const result = (carried ? genResultRecord(DYN, DYN, lowerer.shapes, lowerer.unions) : genResultRecord(type.yieldT, type.retT, lowerer.shapes, lowerer.unions))!;
      const resultType: IrType = type.async ? { kind: "promise", inner: result } : result;
      const supplied = dispatch.source.args.length > 0;
      const incoming = supplied ? varRef("p.1", DYN, loc) : dynUndefinedExpr(loc);
      const channel = mode === "next" ? type.nextT : type.retT;
      const arg = mode === "throw" ? incoming : carried ? incoming : !supplied || channel.kind === "undefinedT" || channel.kind === "void" ? null : lowerer.coerceToExpected(incoming, channel);
      const convertible = dynHoldable(resultType, (id) => lowerer.shapes.get(id), (id) => lowerer.unions.get(id));
      const body: IrStmt[] = [];
      const resume = (argument: IrExpr | null): IrStmt => ({ kind: "return", value: { kind: "dynFrom", value: {
        kind: "genResume", mode, gen: { kind: "dynCheck", value: receiver, type, loc }, arg: argument, type: resultType, loc,
      }, type: DYN, loc }, loc });
      // next(undefined) / return(undefined) is the argument-less resume (an absent argument has no channel value to coerce).
      if (supplied && mode !== "throw" && arg !== null && convertible && typeEquals(arg.type, channel)) body.push({
        kind: "if", cond: { kind: "dynTest", test: "undefined", value: incoming, type: BOOL, loc }, then: [resume(null)], else_: null, loc });
      body.push(convertible && (arg === null || mode === "throw" || (carried && mode === "return") || typeEquals(arg.type, channel))
        ? resume(arg)
        : { kind: "runtimeFence", code: "SC1071", message: "resuming this native generator through an untyped value is not supported yet", loc });
      dispatch.fn.body.unshift({ kind: "if", cond: {
        kind: "libCall", fn: "dyn.typedRefIs", args: [receiver, { kind: "strLit", value: key, type: STRING, loc }], type: BOOL, loc,
      }, then: body, else_: null, loc });
      changed = true;
    }
    return changed;
  }
}
