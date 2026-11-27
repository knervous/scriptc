import type { IrFunction, IrModule } from "./ir.js";
import { everyStmtList } from "./traverse.js";

/** Conservative, transitive effects. Pure means no externally observable
 * effects; it does NOT mean allocation-free, total, or safe to memoize.
 * Unknown operations retain an explicit blocker rather than inheriting a
 * guarantee from their name or a TS annotation. Recompute after IR rewrites. */
export interface FunctionEffects {
  name: string;
  pure: boolean;
  readsMutable: boolean;
  writes: boolean;
  hostOrUnknown: boolean;
  mayThrow: boolean;
  mayDiverge: boolean;
  allocates: boolean;
  blockers: string[];
  calls: string[];
}

export function analyzeFunctionEffects(mod: Pick<IrModule, "functions" | "globals">): Map<string, FunctionEffects> {
  const globals = new Set((mod.globals ?? []).map(g => g.id));
  const summaries = new Map<string, FunctionEffects>();
  for (const f of mod.functions) {
    const s: FunctionEffects = { name: f.name, pure: false, readsMutable: false, writes: false, hostOrUnknown: false, mayThrow: false, mayDiverge: false, allocates: false, blockers: [], calls: [] };
    const boxed = new Set(f.locals.filter(l => l.boxed).map(l => l.id));
    const captures = new Set([...(f.captures ?? []), ...(f.classCaptures ?? [])].map(c => c.localId));
    const locals = new Set(f.locals.map(l => l.id));
    const shared = (id: string) => globals.has(id) || boxed.has(id) || captures.has(id) || !locals.has(id);
    const block = (reason: string) => { if (!s.blockers.includes(reason)) s.blockers.push(reason); };
    const unknown = (kind: string) => { s.hostOrUnknown = true; s.mayThrow = true; block(kind); };
    if (f.async || f.generator) unknown("suspension");
    everyStmtList(f.body, {
      expr(e) {
        switch (e.kind) {
          case "numLit": case "boolLit": case "strLit": case "unitLit": break;
          case "varRef": if (shared(e.localId)) { s.readsMutable = true; s.mayThrow ||= boxed.has(e.localId); block("shared-binding-read"); } break;
          case "incDec": case "assignExpr": if (shared(e.localId)) { s.writes = true; s.mayThrow = true; block("shared-binding-write"); } break;
          case "bin": case "unary": case "logical": case "ternary": case "toBool": break;
          case "call": if (!s.calls.includes(e.callee)) s.calls.push(e.callee); break;
          // Even a typed record may be backed by a page object with accessors.
          // Native field loads need an ownership/backing proof before promotion.
          case "recordGet": case "fieldGet": case "arrayGet": s.readsMutable = true; s.mayThrow = true; block(e.kind); break;
          case "recordLit": case "arrayLit": case "arrayNewLen": case "closure": s.allocates = true; unknown(e.kind); break;
          default: unknown(e.kind);
        }
        return true;
      },
      stmt(st) {
        switch (st.kind) {
          case "varDecl": case "assign": if (shared(st.localId)) { s.writes = true; s.mayThrow = true; block("shared-binding-write"); } break;
          case "return": case "exprStmt": case "if": case "block": case "break": case "continue": case "switch": break;
          case "while": case "doWhile": case "for": s.mayDiverge = true; break;
          default: unknown(st.kind);
        }
        return true;
      },
    });
    summaries.set(f.name, s);
  }
  // Mark cycles separately: a pure recursive function is still not total.
  // A function can reach itself exactly when it lies on a cycle of the call graph: it calls itself, or its strongly connected
  // component has another member. (Tarjan, iterative: one pass over the graph, where a depth-first search from every function
  // was quadratic in the size of the program.) Callees without a summary have no calls of their own.
  {
    const index = new Map<string, number>(), low = new Map<string, number>(), onStack = new Set<string>();
    const stack: string[] = [];
    let counter = 0;
    for (const root of summaries.keys()) {
      if (index.has(root)) continue;
      const work: { name: string; next: number }[] = [{ name: root, next: 0 }];
      index.set(root, counter); low.set(root, counter); counter++; stack.push(root); onStack.add(root);
      while (work.length > 0) {
        const frame = work[work.length - 1]!;
        const calls = summaries.get(frame.name)!.calls;
        if (frame.next < calls.length) {
          const callee = calls[frame.next++]!;
          if (callee === frame.name) summaries.get(callee)!.mayDiverge = true;
          if (!summaries.has(callee)) continue;
          if (!index.has(callee)) {
            index.set(callee, counter); low.set(callee, counter); counter++; stack.push(callee); onStack.add(callee);
            work.push({ name: callee, next: 0 });
          } else if (onStack.has(callee)) low.set(frame.name, Math.min(low.get(frame.name)!, index.get(callee)!));
          continue;
        }
        work.pop();
        if (work.length > 0) { const parent = work[work.length - 1]!.name; low.set(parent, Math.min(low.get(parent)!, low.get(frame.name)!)); }
        if (low.get(frame.name) === index.get(frame.name)) {
          const component: string[] = [];
          for (;;) { const member = stack.pop()!; onStack.delete(member); component.push(member); if (member === frame.name) break; }
          if (component.length > 1) for (const member of component) summaries.get(member)!.mayDiverge = true;
        }
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of summaries.values()) for (const name of s.calls) {
      const callee = summaries.get(name);
      for (const key of ["readsMutable", "writes", "hostOrUnknown", "mayThrow", "mayDiverge", "allocates"] as const) {
        const value = callee ? callee[key] : key === "hostOrUnknown" || key === "mayThrow" || key === "mayDiverge";
        if (value && !s[key]) { s[key] = true; changed = true; }
      }
      if (!callee && !s.blockers.includes(`unresolved-call:${name}`)) s.blockers.push(`unresolved-call:${name}`);
    }
  }
  for (const s of summaries.values()) s.pure = !s.readsMutable && !s.writes && !s.hostOrUnknown;
  return summaries;
}

/** A narrow starting eligibility contract for scalar optimizations. */
export function isTotalScalarFunction(f: IrFunction, effects: FunctionEffects): boolean {
  const scalar = (kind: string) => kind === "f64" || kind === "bool";
  return effects.pure && !effects.mayThrow && !effects.mayDiverge && !effects.allocates &&
    !f.captures?.length && !f.classCaptures?.length && f.params.every(p => scalar(p.type.kind)) && scalar(f.returnType.kind);
}
