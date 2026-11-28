// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
/** Dropping the lifted functions nothing reaches from a lowered module (ported from upstream scriptc bc72046ebe).
 *
 * Lowering lifts functions it later stops using: the stage loops and callbacks of an array chain that pipeline fusion
 * replaces with one loop, a callback lowered once per attempt, narrowing helpers a later rewrite no longer calls. The
 * WasmGC emitter never emits them (its reachability pass), but validation, serialization and the emitter's own
 * whole-module scans still walked them.
 *
 * The fork's reach rule is deliberately wider than the emitter's, so it can only keep more: a function is reached when
 * ANY string anywhere in a kept function (body, params, captures, jsEntry, ...) or in the module's metadata (classes,
 * globals, records, unions, lib exports, FFI imports, ...) spells its name, which covers calls, closures, retag helpers,
 * class prototype helpers, `Error.captureStackTrace` literals and every by-name lookup an IR node can carry (a dynFrom's
 * display-only fnName aside); through the
 * names a `new` or a class value reaches by convention (implicitReferences); and from the module's entry, the names the
 * backend roots with no IR node naming them (backendRoots, native host or not, the error readers and the class
 * normalizer) and the caller's extra roots (link
 * exports). Functions outside `removable` are all kept and all reach, and so are class members, which dispatch reaches
 * by the `%<class>.<member>` convention. */
import type { IrExpr, IrFunction, IrModule } from "./ir.js";
import { everyStmtList } from "./traverse.js";
import { backendRoots, implicitReferences } from "./implicit-references.js";

/** Whether `name` follows the `%<class>.<member>` convention of class methods, accessors and constructors for one of
 * `classNames`. */
export function isClassMemberName(name: string, classNames: ReadonlySet<string>): boolean {
  if (!name.startsWith("%")) return false;
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    if (classNames.has(name.slice(1, dot))) return true;
  }
  return false;
}

/** `mod` without the functions of `removable` that nothing reaches (see the file comment). Returns `mod` itself when
 * every removable function is reached. */
export function withoutUnreachedFunctions(mod: IrModule, removable: ReadonlySet<string>, roots: readonly string[] = []): IrModule {
  const classNames = new Set<string>();
  for (const cls of mod.classes ?? []) classNames.add(cls.name);
  const candidates = new Map<string, IrFunction>();
  for (const fn of mod.functions)
    if (removable.has(fn.name) && fn.name !== mod.entry && !isClassMemberName(fn.name, classNames)) candidates.set(fn.name, fn);
  if (candidates.size === 0) return mod;
  const reached = new Set<string>();
  const pending: IrFunction[] = [];
  const reach = (name: string): void => {
    if (reached.has(name)) return;
    const fn = candidates.get(name);
    if (fn === undefined) return;
    reached.add(name);
    pending.push(fn);
  };
  // A worklist, not recursion over functions; the walk within one tree recurses (IR nesting is bounded by source
  // nesting, as in the emitter's own scan).
  const walk = (value: unknown): void => {
    if (typeof value === "string") { reach(value); return; }
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) walk(value[i]); return; }
    const node = value as Record<string, unknown>;
    if (node["kind"] === "new" || node["kind"] === "classRef")
      for (const implicit of implicitReferences(node as { kind?: unknown; className?: unknown })) reach(implicit.name);
    // A dynFrom's fnName is the display name inspect and call errors spell, not a reference.
    const display = node["kind"] === "dynFrom";
    for (const key in node) if (key !== "loc" && !(display && key === "fnName")) walk(node[key]);
  };
  reach(mod.entry);
  for (const name of backendRoots({ hostHandles: true })) reach(name);
  // The emitters look these up by name when the module defines them, whether or not an expression calls them.
  for (const property of ERROR_READER_PROPERTIES) reach(errorReaderName(property));
  reach(CLASS_NORMALIZER);
  for (const name of roots) reach(name);
  for (const key in mod) if (key !== "functions") walk((mod as unknown as Record<string, unknown>)[key]);
  for (const fn of mod.functions) if (!candidates.has(fn.name)) walk(fn);
  for (let fn = pending.pop(); fn !== undefined; fn = pending.pop()) walk(fn);
  if (reached.size === candidates.size) return mod;
  return { ...mod, functions: mod.functions.filter((fn) => !candidates.has(fn.name) || reached.has(fn.name)) };
}

/** The function an expression names as a value rather than as a direct
 * call's callee: a closure's code, the union→union retag helper an
 * `orDefault` hands its left box to, or the adapter body a `viewOf` or
 * `viewSource` recognizes a view by. These are the only expression fields
 * that hold a module function's name besides `call.callee`
 * (function-references.test.ts classifies every string field of the IR). */
export function exprFunctionReference(expr: IrExpr): string | undefined {
  if (expr.kind === "closure") return expr.fnName;
  if (expr.kind === "orDefault") return expr.retag;
  if (expr.kind === "viewOf" || expr.kind === "viewSource") return expr.adapter ?? undefined;
  return undefined;
}

/** The expression kinds exprFunctionReference answers for. */
export const FUNCTION_REFERENCE_KINDS = ["closure", "orDefault", "viewOf", "viewSource"] as const;

/** Functions the module's metadata names: the entry, library exports,
 * closures' jsword entries, the class prototype helpers the runtime calls
 * and the record links' compose helpers the record walkers call. Class
 * methods and constructors follow the `%<class>.<method>` convention
 * instead of being named here; callers that need them derive them from
 * `mod.classes`. */
export function moduleFunctionReferences(mod: IrModule): string[] {
  return metadataReferences(mod, true);
}

/** moduleFunctionReferences, with or without the closures' jsword entries.
 * A function names its entry for itself, so a walk that follows functions
 * (withoutUnreachedFunctions) reaches an entry when it reaches its closure. */
function metadataReferences(mod: IrModule, jsEntries: boolean): string[] {
  const names = [mod.entry];
  for (const entry of mod.lib?.exports ?? []) names.push(entry.fnName);
  if (jsEntries)
    for (const fn of mod.functions) if (fn.jsEntry !== undefined) names.push(fn.jsEntry);
  for (const cls of mod.classes ?? []) {
    if (cls.prototypeDataHelper !== undefined) names.push(cls.prototypeDataHelper);
    if (cls.instancePrototypeHelper !== undefined) names.push(cls.instancePrototypeHelper);
    if (cls.arrayFields !== undefined) names.push(cls.arrayFields);
    if (cls.arraySpecies !== undefined) names.push(cls.arraySpecies);
    if (cls.stringTagHelper !== undefined) names.push(cls.stringTagHelper);
    for (const accessor of cls.viewAccessors ?? []) names.push(accessor.helper);
  }
  for (const link of mod.recordLinks ?? []) names.push(link.compose);
  return names;
}

/** The properties of an error whose reads the runtime answers through a
 * function of the module (errorReaderName), when the module defines it. */
export const ERROR_READER_PROPERTIES = ["name", "message"] as const;

/** The module function the runtime calls to read an error's `property`. The
 * emitter installs it when the module defines it; no expression names it. */
export function errorReaderName(property: string): string {
  return `%error.${property}.read`;
}

/** The table that reboxes class instances to their exact classes. The
 * emitter reads its branches when the module defines it, whether or not an
 * expression calls it. */
export const CLASS_NORMALIZER = "%dyn.class.normalize";

