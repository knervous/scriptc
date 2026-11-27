/* Copies that TypeScript would alias: a dyn value checked into a record or array type.
 *
 * A typed view of an `any` object (`const doc: Doc = raw`, `f(raw)` into a Doc parameter, `raw as Doc[]`) names the
 * same object in TypeScript. The native object model keeps dyn objects and typed records apart, so the dynCheck that
 * converts one builds a new record (or array) from the dyn object's properties. A value that is already a compiled
 * record of the target type passes through as itself (no copy), so only a dyn/page object is copied.
 *
 * The owner's rule (10-28): the copy is acceptable only where it cannot be observed, which this check takes to mean
 * that no dyn binding the converted value was read from is read again in the same function after the conversion
 * (in source order, or anywhere in a loop around it). A fresh value (`JSON.parse(text)`, a call's result) has no such
 * binding. Anything else is refused at compile time, naming the binding.
 *
 * Conservative by design: a read on a branch that cannot follow the conversion still counts. */
import type { IrExpr, IrFunction, IrType, SrcLoc } from "../../ir/ir.js";

/** `node` the dynCheck; `parsed` when the binding holds only JSON.parse results (a dyn object for certain: the copy is
 * certain, so the compiler refuses); otherwise the value may be a compiled record passing through any, which aliases,
 * and the emitter fences the copy at run time instead. */
export interface AliasingCopy { loc: SrcLoc; binding: string; target: string; node: IrExpr; parsed: boolean }

const LOOPS = new Set(["for", "while", "doWhile", "forIn", "forOf"]);

// A dyn read's path: the binding, then each property read on it (named by its getter helper, one per property name;
// an element read matches any). The outermost read of a chain registers it; the reads inside are part of it.
const isGetter = (e: IrExpr): e is IrExpr & { kind: "call" } =>
  e.kind === "call" && (e.callee.startsWith("%dyn.class.property.") || e.callee === "%dyn.class.index.get") && e.args.length >= 1;
function chainOf(e: IrExpr): string[] | null {
  if (e.kind === "varRef") return e.type.kind === "dyn" ? [e.localId] : null;
  if (!isGetter(e)) return null;
  const base = chainOf(e.args[0]!);
  return base ? [...base, e.callee === "%dyn.class.index.get" ? "*" : e.callee] : null;
}
/** The paths a converted value is read from: itself when it is a dyn binding or a property chain on one, through ?? and
 * conditional arms. A call's or method's result is a fresh value: no path. */
function pathChains(e: IrExpr, into: string[][]): void {
  const c = chainOf(e);
  if (c) { into.push(c); return; }
  if (e.kind === "nullish") { pathChains(e.left, into); pathChains(e.right, into); }
  else if (e.kind === "ternary") { pathChains(e.then, into); pathChains(e.else_, into); }
}
/** One path contains the other (an element read matches any step). */
const overlaps = (a: string[], b: string[]) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i] && a[i] !== "*" && b[i] !== "*") return false; return true; };

export function findAliasingCopies(f: IrFunction, opts: { copies(t: IrType): boolean; describe(t: IrType): string; name(id: string): string }): AliasingCopy[] {
  // Preorder index of every varRef read of a dyn binding, and the loop nests.
  let n = 0;
  // Each node's arms: the (if or conditional, arm) pairs it sits under. Two nodes in different arms of one
  // conditional never both run, so a read there does not follow the conversion.
  // An arm whose statements end in return or throw: nothing after it runs once it has (its end is filled in).
  type Arm = readonly [number, string, { term: boolean; end: number }];
  const reads = new Map<string, { at: number; loops: number[]; arms: Arm[]; chain: string[] }[]>();
  const inner = new WeakSet<object>();
  const declLoops = new Map<string, number[]>();
  const writes = new Map<string, (IrExpr | null)[]>();
  const checks: { at: number; end: number; e: IrExpr & { kind: "dynCheck" }; loops: number[]; arms: Arm[] }[] = [];
  const loopStack: number[] = [];
  const armStack: Arm[] = [];
  const visit = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) visit(x); return; }
    const o = v as Record<string, unknown> & { kind?: string };
    const at = n++;
    const isLoop = typeof o.kind === "string" && LOOPS.has(o.kind);
    if (isLoop) loopStack.push(at);
    const e = o as unknown as IrExpr;
    if (!inner.has(o) && (e.kind === "varRef" || isGetter(e))) {
      const chain = chainOf(e);
      if (chain) {
        const list = reads.get(chain[0]!) ?? [];
        list.push({ at, loops: [...loopStack], arms: [...armStack], chain });
        reads.set(chain[0]!, list);
      }
    }
    if (isGetter(e)) inner.add(e.args[0] as object);
    if ((o.kind === "varDecl" || o.kind === "assign") && typeof o.localId === "string") {
      const v = (o.kind === "varDecl" ? o.init : o.value) as IrExpr | null | undefined;
      const list = writes.get(o.localId) ?? [];
      list.push(v ?? null);
      writes.set(o.localId, list);
    }
    // A binding declared inside a loop is a new binding each iteration: that loop's earlier passes read another value.
    if (o.kind === "varDecl" && typeof o.localId === "string" && !declLoops.has(o.localId)) declLoops.set(o.localId, [...loopStack]);
    const check = o.kind === "dynCheck" && opts.copies(o.type as IrType) ? { at, end: 0, e: o as unknown as IrExpr & { kind: "dynCheck" }, loops: [...loopStack], arms: [...armStack] } : null;
    const branching = o.kind === "if" || o.kind === "ternary";
    for (const k in o) {
      if (k === "loc" || k === "type") continue;
      const arm = branching && (k === "then" || k === "else_");
      const body = o[k];
      const last = Array.isArray(body) ? (body.at(-1) as { kind?: string } | undefined) : undefined;
      const info = { term: o.kind === "if" && (last?.kind === "return" || last?.kind === "throw"), end: Infinity };
      if (arm) armStack.push([at, k, info]);
      visit(body);
      if (arm) { armStack.pop(); info.end = n; }
    }
    if (check) { check.end = n; checks.push(check); }
    if (isLoop) loopStack.pop();
  };
  const exclusive = (a: readonly Arm[], b: readonly Arm[]) => a.some(([id, k]) => b.some(([id2, k2]) => id === id2 && k !== k2));
  // Past the end of a returning arm around the check, no read follows it.
  const cutoff = (arms: readonly Arm[]) => Math.min(...arms.filter(([, , i]) => i.term).map(([, , i]) => i.end));
  visit(f.body);
  const out: AliasingCopy[] = [];
  for (const c of checks) {
    // The paths the converted value is read from; a later read of an overlapping path (the same object, a part of it,
    // or what holds it) would see the original where TypeScript sees the converted value.
    const chains: string[][] = [];
    pathChains(c.e.value, chains);
    const stop = cutoff(c.arms);
    for (const chain of chains) {
      // The compiler's own temporaries (a yield* step, a destructuring source) are read as the lowering needs.
      if (opts.name(chain[0]!).startsWith("%")) continue;
      // Loops around both the read and the check whose next pass still has the same binding.
      const fresh = declLoops.get(chain[0]!) ?? [];
      const repeats = (r: { loops: number[] }) => r.loops.some(l => c.loops.includes(l) && !fresh.includes(l));
      const again = (reads.get(chain[0]!) ?? []).some(r => overlaps(r.chain, chain) && (
        ((r.at >= c.end) && r.at < stop && !(exclusive(r.arms, c.arms) && !repeats(r))) ||
        ((r.at < c.at) && repeats(r))));
      if (again) {
        const ws = writes.get(chain[0]!) ?? [];
        const parsed = ws.length > 0 && ws.every(w => w?.kind === "libCall" && w.fn === "json.parse");
        out.push({ loc: c.e.loc, binding: opts.name(chain[0]!), target: opts.describe(c.e.type), node: c.e, parsed });
        break;
      }
    }
  }
  return out;
}
