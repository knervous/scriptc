/* Virtual calls of an abstract method no class in the program implements.
 *
 * A library compiled whole always has the concrete subclasses of its abstract classes. A program built from part of
 * it -- a separately compiled piece, a focused entry -- can reach an abstract class's own methods (through a sibling
 * class it does construct, a static, a type-only collection) while every concrete subclass stays outside it. Such a
 * virtual call can never execute: no instance of the static class or any class below it can exist in this program.
 * The IR validator rightly refuses a virtualCall with no implementation, so the call becomes a direct call of a
 * synthesized function that fences when it runs (`runtimeFence`, SC9003) -- the same honest trap a TypeScript
 * fallthrough gets -- instead of an internal compiler error.
 *
 * The proof is that no class at or below the static class can be instantiated: every one is abstract (a generic base's
 * instantiation kept for its methods while the subclass that extends it with those type arguments is not in the
 * program, say). That fence is SC9003, a proven-unreachable trap like SC9002, so a release build admits it. A
 * concrete class there without the implementation would be a compiler gap, not a dead call: its fence is SC9001 and
 * a release build refuses it.
 *
 * Only that case: a call with any implementation at or below its static class is left as it is. */
import type { IrClassDef, IrExpr, IrFunction, IrModule } from "../../ir/ir.js";
import { transformStmtList } from "../../ir/traverse.js";

/** `neverInstantiated`: classes declared in a module this program never runs (classModuleNeverRuns), or whose constructor
 * the program never reaches (Lowerer.classCanBeConstructed, the reachability that dropped their overrides): no instance
 * of one can exist, whatever its own declaration says, so a call whose static class and every class below it are among
 * them, or abstract, is a proven-unreachable SC9003 as well. */
export function trapUnimplementedVirtualCalls(mod: IrModule, neverInstantiated: ReadonlySet<string> = new Set()): number {
  const classes = new Map<string, IrClassDef>((mod.classes ?? []).map((c) => [c.name, c]));
  const functionNames = new Set(mod.functions.map((f) => f.name));
  const isBelow = (name: string, ancestor: string): boolean => {
    for (let c = classes.get(name); c?.base !== undefined; c = classes.get(c.base)) if (c.base === ancestor) return true;
    return false;
  };
  const concreteIn = (c: IrClassDef, method: string): boolean =>
    (c.methods?.includes(method) ?? false) && !(c.abstractMethods?.includes(method) ?? false) && functionNames.has(`%${c.name}.${method}`);
  const unimplemented = new Map<string, boolean>();
  const isUnimplemented = (className: string, method: string): boolean => {
    const key = `${className}\u0000${method}`;
    const known = unimplemented.get(key);
    if (known !== undefined) return known;
    let found = false;
    // At or above: the nearest declaration, when concrete.
    for (let c = classes.get(className); c && !found; c = c.base !== undefined ? classes.get(c.base) : undefined) {
      if (c.methods?.includes(method)) {
        found = concreteIn(c, method);
        break;
      }
    }
    // Below: any strict subclass with an implementation.
    for (const c of classes.values()) {
      if (found) break;
      if (isBelow(c.name, className) && concreteIn(c, method)) found = true;
    }
    unimplemented.set(key, !found);
    return !found;
  };
  // A class whose instances can exist: not declared abstract, with no abstract slot of its own, and its module runs.
  const instantiable = (c: IrClassDef): boolean => c.abstract !== true && (c.abstractMethods?.length ?? 0) === 0 && !neverInstantiated.has(c.name);
  const noInstanceAtOrBelow = (className: string): boolean =>
    ![...classes.values()].some((c) => (c.name === className || isBelow(c.name, className)) && instantiable(c));
  const traps = new Map<string, IrFunction>();
  let rewritten = 0;
  const rewrite = (e: IrExpr): IrExpr => {
    if (e.kind !== "virtualCall" || !isUnimplemented(e.className, e.method)) return e;
    const name = `%${e.className}.${e.method}%unimplemented`;
    if (!traps.has(name)) {
      const params = e.args.map((arg, i) => ({ localId: `p${i}`, name: `p${i}`, type: arg.type }));
      traps.set(name, {
        name,
        params,
        returnType: e.type,
        locals: params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
        body: [noInstanceAtOrBelow(e.className) ? {
          kind: "runtimeFence",
          code: "SC9003",
          message: `${e.className}.${e.method} is abstract and no class in this program implements it`,
          loc: e.loc,
        } : {
          kind: "runtimeFence",
          code: "SC9001",
          message: `internal compiler error: ${e.className}.${e.method} has no implementation in a class of this program that can be instantiated — please report this`,
          loc: e.loc,
        }],
        loc: e.loc,
      });
    }
    rewritten++;
    return { kind: "call", callee: name, args: e.args, type: e.type, loc: e.loc };
  };
  for (const fn of mod.functions) {
    fn.body = transformStmtList(fn.body, { expr: rewrite, stmt: (s) => s });
  }
  for (const trap of traps.values()) mod.functions.push(trap);
  return rewritten;
}
