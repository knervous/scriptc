/* Int shadows: an unboxed int32 alongside a dynamic local that mostly holds
 * small integers (native dyn, every function that is neither async nor a
 * generator).
 *
 * Minified code keeps flag words, tags and bit sets in `var` locals and
 * parameters (React's reconciler, for one):
 *
 *   var flags = finishedWork.flags;          // an i32 struct field
 *   switch (finishedWork.tag) { ... }       // %switch = an i32 struct field
 *   flags & 4 && commitHookEffects(...);
 *   (parent.childLanes & renderLanes) !== renderLanes
 *
 * The checker types such locals `any`, so every definition boxes the number
 * and every bitwise use unboxes it again. A shadowed local L keeps, next to
 * its dyn wasm local d, an i32 i and two flags:
 *
 *   k   1 when i holds L's value (an int32, never -0);
 *   ds  1 when d is stale (L was last defined from an int); then k is 1.
 *
 * A definition whose value can come out as an int32 (an i32 struct field
 * read, a bitwise operator, an int32 constant, a number expression that turns
 * out integral, another shadowed local) stores i and sets k (and ds when no
 * box exists); any other definition stores d and clears both. Parameters
 * test their incoming value once at entry. A use that consumes an int32
 * (a bitwise operand, `===` against a number or another int, a write to an
 * i32 struct field, a case label, a number conversion) reads i while k is 1
 * and converts d otherwise; any other use reads d, boxing i first (and
 * keeping the box) while ds is 1. Every write keeps the pair consistent,
 * so the shadow is exact whatever the control flow.
 *
 * Shadowed: plain dyn locals and parameters (not boxed, not captured, a
 * parameter not visible through an arguments object) that the body names
 * only by reading, declaring or assigning them, with at least one int use,
 * no more other uses than int uses, and an int definition (a parameter with
 * two int uses needs none). */
import type { IrExpr, IrFunction } from "../../ir/ir.js";

export interface IntShadowHooks {
  /** Whether a definition value can come out as an int32 without boxing. */
  intValue(e: IrExpr, shadowed: (id: string) => boolean): boolean;
  /** Whether a call writes its second argument to an i32 struct field (or another int sink). */
  intSink(call: IrExpr & { kind: "call" }): boolean;
}

export interface IntShadow { param: boolean }

const isNumberConst = (e: IrExpr): boolean =>
  e.kind === "numLit" || e.kind === "dynFrom" && e.value.kind === "numLit" || e.type.kind === "f64";

export function computeIntShadows(f: IrFunction, hooks: IntShadowHooks): Map<string, IntShadow> {
  const out = new Map<string, IntShadow>();
  if (f.async || f.generator) return out;
  const usesArguments = (f.paramModes ?? []).some(mode => mode !== "required" && mode !== "omittable") || f.locals.some(l => l.name === "arguments");
  const params = new Set(f.params.map(p => p.localId));
  const captures = new Set((f.captures ?? []).map(c => c.localId));
  const candidates = new Set(f.locals.filter(l => l.type.kind === "dyn" && !l.boxed && !captures.has(l.id) && !(usesArguments && params.has(l.id))).map(l => l.id));
  for (const p of f.params) if (p.type.kind === "dyn" && !usesArguments && !captures.has(p.localId) && f.locals.some(l => l.id === p.localId && !l.boxed)) candidates.add(p.localId);
  if (!candidates.size) return out;

  const excluded = new Set<string>();
  const defs: { id: string; value: IrExpr }[] = [];
  /** varRef nodes in an int-consuming position (copies included: their target decides). */
  const intRefs = new Set<IrExpr>();
  const copies: { from: string; to: string; ref: IrExpr }[] = [];
  const isRef = (e: IrExpr | undefined): e is IrExpr & { kind: "varRef" } => e?.kind === "varRef" && candidates.has(e.localId);

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    const o = n as Record<string, unknown> & { kind?: string; localId?: string };
    if (typeof o.localId === "string" && candidates.has(o.localId)) {
      if (o.kind === "varDecl" || o.kind === "assign") {
        const value = (o.kind === "varDecl" ? o.init : o.value) as IrExpr | null | undefined;
        if (value) { defs.push({ id: o.localId, value }); if (isRef(value)) { intRefs.add(value); copies.push({ from: value.localId, to: o.localId, ref: value }); } }
      } else if (o.kind !== "varRef") excluded.add(o.localId);
    }
    if (typeof o.catchLocalId === "string") excluded.add(o.catchLocalId);
    // Int-consuming positions.
    const e = o as unknown as IrExpr;
    if (e.kind === "libCall" && e.fn === "dyn.bitwise") { for (const a of e.args.slice(0, 2)) if (isRef(a)) intRefs.add(a); }
    else if (e.kind === "dynScalarEq" && !e.identity) {
      if (isRef(e.left) && (isNumberConst(e.right) || isRef(e.right) || hooks.intValue(e.right, () => false))) intRefs.add(e.left);
      if (isRef(e.right) && (isNumberConst(e.left) || isRef(e.left) || hooks.intValue(e.left, () => false))) intRefs.add(e.right);
    } else if (e.kind === "call" && e.args.length === 2 && isRef(e.args[1]) && hooks.intSink(e)) intRefs.add(e.args[1]!);
    else if (e.kind === "dynCheck" && e.type.kind === "f64" && isRef(e.value)) intRefs.add(e.value);
    // + - and comparisons against a number, an int form or another candidate (the emitter's int paths).
    else if (e.kind === "libCall" && (e.fn === "dyn.add" || e.fn === "dyn.compare" || e.fn === "dyn.arithmetic" && e.args[2]?.kind === "strLit" && e.args[2].value === "-")) {
      const [l, r] = e.args;
      const intish = (x: IrExpr | undefined) => !!x && (isNumberConst(x) || isRef(x) || hooks.intValue(x, () => false));
      if (isRef(l) && intish(r)) intRefs.add(l);
      if (isRef(r) && intish(l)) intRefs.add(r);
    }
    for (const k in o) if (k !== "loc" && k !== "type") { const v = o[k]; if (v && typeof v === "object") visit(v); }
  };
  visit(f.body);
  for (const id of excluded) candidates.delete(id);
  // Uses outside int positions (copies are int positions only into a shadowed target: counted per round).
  const intUses = new Map<string, number>(), dynUses = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string, by = 1) => m.set(id, (m.get(id) ?? 0) + by);
  const copyRefs = new Set(copies.map(c => c.ref));
  const count = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) count(x); return; }
    const o = n as Record<string, unknown> & { kind?: string; localId?: string };
    if (o.kind === "varRef" && typeof o.localId === "string" && candidates.has(o.localId)) {
      const r = o as unknown as IrExpr;
      if (!intRefs.has(r)) bump(dynUses, o.localId); else if (!copyRefs.has(r)) bump(intUses, o.localId);
    }
    for (const k in o) if (k !== "loc" && k !== "type") { const v = o[k]; if (v && typeof v === "object") count(v); }
  };
  count(f.body);

  // Fixpoint over copies: a copy is an int definition of its target when the
  // source is shadowed, and an int use of its source when the target is.
  // Optimistic start (every candidate shadowed), so chains of copies (a
  // switch's hidden discriminant copied from a local) survive; the shadows
  // are exact for any set, the rounds only pick where they pay.
  let shadowed = new Set(candidates);
  for (let round = 0; round < 8; round++) {
    const next = new Set<string>();
    for (const id of candidates) {
      let ints = intUses.get(id) ?? 0, others = dynUses.get(id) ?? 0;
      for (const c of copies) if (c.from === id) { if (shadowed.has(c.to)) ints++; else others++; }
      if (!ints || others > ints) continue;
      const intDef = defs.some(d => d.id === id && hooks.intValue(d.value, x => shadowed.has(x)));
      if (intDef || params.has(id) && ints >= 2) next.add(id);
    }
    const same = next.size === shadowed.size && [...next].every(x => shadowed.has(x));
    shadowed = next;
    if (same) break;
  }
  for (const id of shadowed) out.set(id, { param: params.has(id) });
  return out;
}
