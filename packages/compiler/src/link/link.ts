/* Separate compilation, the linker (docs-draft/OBJECT_FILES_POC.md). It resolves every object's references against the
 * other objects' definitions (each with the key it was compiled against: a signature, a class layout, a global's
 * type), keeps one copy of each COMDAT helper and runtime class, merges records and unions by their structural ids,
 * checks the class-hierarchy assumptions each object's frontend made, and joins the objects into one IR program. The
 * backend then emits that program as one module: every GC type is defined once, in the rec groups a whole-program
 * build would give it, so no type crosses a module boundary at all. */
import type { IrClassDef, IrFfiImport, IrFunction, IrGlobal, IrModule, IrObjectClassView, IrRecordShape, IrUnionDef } from "../ir/ir.js";
import { validateModule } from "../ir/validate.js";
import { setBrowserTarget, setNativeAny, setNativeDyn } from "../frontend/browser-target.js";
import { emitWasmGcModule, optimiseWasmGcBinary, WASMGC_HOST_ABI, type WasmGcEmitOptions } from "../backend/wasmgc/emitter.js";
import { IR_VERSION } from "../ir/serialize.js";
import { HEADER_PLACEHOLDER_CODE } from "./module-tag.js";
import { classKey, enumeratesProgram, PROGRAM_DISPATCH_MODULE, frontendDigest, functionKey, globalKey, initializerTag, isComdatGlobal, WASMGC_OBJECT_SCHEMA, tagOfGlobal, tagOfSymbol, withoutLocs, type ObjectTarget, type WasmGcObject } from "./object.js";

/** What would cure a link problem: "reseed" (the objects disagree with each other or with the build's revision, so
 * one lowering of the current program must replace them: compileProgramObjects). Problems with no request (a module
 * with no object, a duplicate definition, an unsupported construct) are not cured by rebuilding the same sources. */
export interface LinkRequest {
  kind: "reseed";
  reason: string;
}

export class LinkError extends Error {
  constructor(readonly problems: readonly string[], readonly requests: readonly LinkRequest[] = []) {
    super(`link failed:\n  ${problems.join("\n  ")}`);
  }
}

export interface LinkOptions {
  /** The module whose top level is the program's (its `%main` survives): a module path as objects record it. Default:
   * the object no other object's program saw. */
  entry?: string;
  /** Backend options the program is built with beyond the target's (hostHandles, link, noPageFacades, ...), as a
   * whole-program build passes them to the emitter. */
  emit?: Partial<WasmGcEmitOptions>;
  /** The program revision the build request captured (ObjectStamp.program of its current sources): every object must
   * have been lowered from it. Without it, every object must still share one revision. */
  revision?: string;
  /** Diagnostics only: link objects lowered from different program revisions. A constant or other compile-time fact one
   * object read can then be stale (Astra §15.3): the result is not a build. */
  acceptMixedRevisions?: true;
  /** The build coordinator (link/build.ts buildObjects) validated every object of an older revision: each one's read set
   * is unchanged in the current sources. Mixed revisions then link; every other check still runs. */
  reuseValidated?: true;
}

interface Defined<T> { object: WasmGcObject; def: T; key: string }

/** A frontend dispatcher that enumerates the program's classes or generators (class-dynamic-dispatch.ts,
 * generator-dynamic-dispatch.ts): an object's copy knows only what its own program held. */

const sameTarget = (a: ObjectTarget, b: ObjectTarget): boolean =>
  a.browser === b.browser && a.dynModel === b.dynModel && a.experimentalTsNativeAny === b.experimentalTsNativeAny;

/** Objects in dependency order: a module before every object whose program saw it (a whole-program build's module
 * order, so its init calls and type definitions keep their order). Stable otherwise. */
function dependencyOrder(objects: readonly WasmGcObject[]): WasmGcObject[] {
  const byTag = new Map(objects.map((o) => [o.module.tag, o]));
  const out: WasmGcObject[] = [], placed = new Set<string>();
  const place = (o: WasmGcObject): void => {
    if (placed.has(o.module.tag)) return;
    placed.add(o.module.tag);
    for (const tag of o.sees) { const dep = byTag.get(tag); if (dep && dep !== o) place(dep); }
    out.push(o);
  };
  for (const o of objects) place(o);
  return out;
}

/** Classes with every base before its subclasses. */
function basesFirst(classes: readonly IrClassDef[]): IrClassDef[] {
  const byName = new Map(classes.map((c) => [c.name, c]));
  const out: IrClassDef[] = [], placed = new Set<string>();
  const place = (c: IrClassDef): void => {
    if (placed.has(c.name)) return;
    placed.add(c.name);
    const base = c.base === undefined ? undefined : byName.get(c.base);
    if (base) place(base);
    out.push(c);
  };
  for (const c of classes) place(c);
  return out;
}

/** What an IR fragment dispatches over: the symbols it names (`%`-prefixed classes, functions, globals) and its string
 * literals (property keys, type keys). Local ids and node kinds are left out: they differ between lowerings. */
function namesOf(value: unknown, out: Set<string>): void {
  if (typeof value === "string") { if (value.startsWith("%")) out.add(value); }
  else if (Array.isArray(value)) for (const item of value) namesOf(item, out);
  else if (value !== null && typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (node["kind"] === "strLit" && typeof node["value"] === "string") out.add(`"${node["value"]}`);
    for (const [key, item] of Object.entries(node)) if (key !== "loc" && key !== "localId") namesOf(item, out);
  }
}

/** Joins objects into one IR program, or throws a LinkError listing every problem. */
export function linkObjects(input: readonly WasmGcObject[], opts: LinkOptions = {}): IrModule {
  const problems: string[] = [], requests: LinkRequest[] = [];
  // Objects partitioned from one lowering share their definitions (linkProgram): one key per definition, computed once
  // however many objects carry it, and an identical definition is never compared with itself.
  const keys = new WeakMap<object, string>();
  const keyOf = (value: object, derive: () => string = () => withoutLocs(value)): string => {
    let key = keys.get(value);
    if (key === undefined) { key = derive(); keys.set(value, key); }
    return key;
  };
  /** A problem a reseed of the current program cures (LinkRequest). */
  const stale = (message: string): void => { problems.push(message); requests.push({ kind: "reseed", reason: message }); };
  if (input.length === 0) throw new LinkError(["no objects"]);
  const first = input[0]!;
  for (const o of input) {
    // Objects lowered by another compiler frontend (or with other options) can name and shape things differently: every
    // object must come from the frontend doing the link, under one set of options.
    if (o.schema !== WASMGC_OBJECT_SCHEMA) problems.push(`${o.module.path}: object schema ${o.schema}, not ${WASMGC_OBJECT_SCHEMA}`);
    if (!o.stamp) problems.push(`${o.module.path}: no provenance stamp (recompile it)`);
    else if (o.stamp.frontend !== frontendDigest()) problems.push(`${o.module.path}: lowered by compiler frontend ${o.stamp.frontend.slice(0, 12)}, not this one (${frontendDigest().slice(0, 12)}): recompile it`);
    if (o.stamp && first.stamp && o.stamp.options !== first.stamp.options) problems.push(`${o.module.path}: compiled with other options than ${first.module.path}`);
    if (o.irVersion !== IR_VERSION || o.hostAbi !== WASMGC_HOST_ABI) problems.push(`${o.module.path}: IR ${o.irVersion} / ${o.hostAbi}, not this compiler's IR ${IR_VERSION} / ${WASMGC_HOST_ABI}`);
    if (!sameTarget(o.target, first.target)) problems.push(`${o.module.path}: compiled for ${JSON.stringify(o.target)}, but ${first.module.path} for ${JSON.stringify(first.target)}`);
  }
  // One program revision. Hierarchy, dispatch and initializer checks cannot see a compile-time fact an object read
  // (an inlined constant, say), so a set mixing revisions is refused until a recorded read set can prove otherwise.
  if (!opts.acceptMixedRevisions && !opts.reuseValidated) {
    const revisions = new Map<string, string[]>();
    for (const o of input) if (o.stamp) revisions.set(o.stamp.program, [...(revisions.get(o.stamp.program) ?? []), o.module.path]);
    if (opts.revision !== undefined) {
      for (const [revision, paths] of revisions) if (revision !== opts.revision)
        stale(`${paths.slice(0, 4).join(", ")}${paths.length > 4 ? ` (+${paths.length - 4})` : ""}: lowered from program revision ${revision.slice(0, 12)}, not the build's ${opts.revision.slice(0, 12)}: reseed the program (compileProgramObjects)`);
    } else if (revisions.size > 1) {
      const listed = [...revisions].map(([revision, paths]) => `${revision.slice(0, 12)} (${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` +${paths.length - 3}` : ""})`);
      stale(`objects from ${revisions.size} program revisions: ${listed.join("; ")}: reseed the program (compileProgramObjects)`);
    }
  }
  const byTag = new Map<string, WasmGcObject>();
  for (const o of input) {
    const other = byTag.get(o.module.tag);
    if (other) problems.push(`${o.module.path} and ${other.module.path} share the module tag ${o.module.tag}${o.module.path === other.module.path ? " (the same module twice)" : " (a path hash collision)"}`);
    byTag.set(o.module.tag, o);
  }
  const objects = dependencyOrder(input);
  const seenByOthers = new Set(objects.flatMap((o) => o.sees.filter((t) => t !== o.module.tag)));
  const entries = opts.entry !== undefined ? objects.filter((o) => o.module.path === opts.entry) : objects.filter((o) => !seenByOthers.has(o.module.tag));
  if (entries.length !== 1) problems.push(opts.entry !== undefined ? `no object for the entry module ${opts.entry}` : `no single entry module (candidates: ${entries.map((o) => o.module.path).join(", ") || "none"}); pass one`);
  if (problems.length > 0) throw new LinkError(problems, requests);
  const entry = entries[0]!;

  // Definitions. A tagged symbol has exactly one definer, its module's object; a COMDAT has a copy in every object
  // that reaches it, and the copies must agree.
  const fns = new Map<string, Defined<IrFunction>>(), classes = new Map<string, Defined<IrClassDef>>(), globals = new Map<string, Defined<IrGlobal>>();
  const dispatchers = new Map<string, Defined<IrFunction>[]>();
  const comdats = new Map<string, Defined<IrFunction>>(), runtimeClasses = new Map<string, Defined<IrClassDef>>(), comdatClasses = new Map<string, Defined<IrClassDef>>();
  const records = new Map<string, Defined<IrRecordShape>>(), unions = new Map<string, Defined<IrUnionDef>>();
  for (const object of objects) {
    const comdatNames = new Set(object.comdat);
    for (const fn of object.ir.functions) {
      if (fn.name === "%main") continue;
      if (comdatNames.has(fn.name) && enumeratesProgram(fn.name)) {
        dispatchers.set(fn.name, [...(dispatchers.get(fn.name) ?? []), { object, def: fn, key: keyOf(fn) }]);
        continue;
      }
      if (comdatNames.has(fn.name)) {
        const prior = comdats.get(fn.name), body = prior?.def === fn ? prior.key : keyOf(fn);
        if (!prior) comdats.set(fn.name, { object, def: fn, key: body });
        else if (prior.key !== body) stale(`COMDAT ${fn.name}: ${object.module.path}'s copy differs from ${prior.object.module.path}'s`);
        continue;
      }
      if (tagOfSymbol(fn.name) !== object.module.tag) { problems.push(`${object.module.path} defines ${fn.name}, a symbol of another module`); continue; }
      const prior = fns.get(fn.name);
      if (prior) problems.push(`duplicate symbol ${fn.name} in ${prior.object.module.path} and ${object.module.path}`);
      else fns.set(fn.name, { object, def: fn, key: functionKey(fn) });
    }
    const comdatClassNames = new Set(object.comdatClasses);
    for (const cls of object.ir.classes ?? []) {
      // A generic instantiation: every object that instantiates it carries it. Copies must agree on the layout; the
      // members each one reached are united (each member is a COMDAT function of its own).
      if (comdatClassNames.has(cls.name)) {
        const key = classKey(cls), prior = comdatClasses.get(cls.name);
        if (!prior) comdatClasses.set(cls.name, { object, def: { ...cls }, key });
        else if (prior.key !== key) stale(`instantiation ${cls.name}: ${object.module.path}'s layout differs from ${prior.object.module.path}'s`);
        else {
          const unite = (a: string[] | undefined, b: string[] | undefined): string[] | undefined => (a === undefined && b === undefined ? undefined : [...new Set([...(a ?? []), ...(b ?? [])])]);
          const methods = unite(prior.def.methods, cls.methods), declared = unite(prior.def.declaredMethods, cls.declaredMethods);
          if (methods) prior.def.methods = methods;
          if (declared) prior.def.declaredMethods = declared;
        }
        continue;
      }
      if (cls.runtime) {
        const prior = runtimeClasses.get(cls.name), body = prior?.def === cls ? prior.key : keyOf(cls);
        if (!prior) runtimeClasses.set(cls.name, { object, def: cls, key: body });
        else if (prior.key !== body) problems.push(`runtime class ${cls.name}: ${object.module.path}'s definition differs from ${prior.object.module.path}'s`);
        continue;
      }
      const prior = classes.get(cls.name);
      if (prior) problems.push(`duplicate class ${cls.name} in ${prior.object.module.path} and ${object.module.path}`);
      else classes.set(cls.name, { object, def: cls, key: classKey(cls) });
    }
    for (const g of object.ir.globals ?? []) {
      const prior = globals.get(g.id);
      if (prior && isComdatGlobal(g.id)) { if (prior.key !== globalKey(g)) problems.push(`COMDAT global ${g.id}: ${object.module.path}'s type differs from ${prior.object.module.path}'s`); }
      else if (prior) problems.push(`duplicate global ${g.id} in ${prior.object.module.path} and ${object.module.path}`);
      else globals.set(g.id, { object, def: g, key: globalKey(g) });
    }
    // Records and unions are named by their structural key (the frontend's keyed ids), so equal ids are equal types.
    // A record's declaredOrder is first-seen metadata, not identity: the first object's wins, as in a whole program.
    for (const r of object.ir.records ?? []) {
      const prior = records.get(r.id), key = prior?.def === r ? prior.key : keyOf(r, () => withoutLocs({ fields: r.fields, tuple: r.tuple ?? false, indexValue: r.indexValue ?? null }));
      if (!prior) records.set(r.id, { object, def: r, key });
      else if (prior.key !== key) problems.push(`record ${r.id}: ${object.module.path}'s shape differs from ${prior.object.module.path}'s`);
    }
    for (const u of object.ir.unions ?? []) {
      const prior = unions.get(u.id), key = prior?.def === u ? prior.key : keyOf(u);
      if (!prior) unions.set(u.id, { object, def: u, key });
      else if (prior.key !== key) problems.push(`union ${u.id}: ${object.module.path}'s arms differ from ${prior.object.module.path}'s`);
    }
  }

  // Program-enumerating dispatchers: a copy is right only if its object saw every module whose classes (or generators)
  // the linked program holds. Prefer such a copy; with none, the link would answer for fewer classes than the program has.
  // A header-mode object saw every module of its program but lowered none of their bodies, so its copy covers only the
  // classes and members its own code reaches: never complete.
  const classModules = new Set([...classes.values(), ...comdatClasses.values()].map((d) => d.object.module.tag));
  const generatorModules = new Set(objects.filter((o) => o.ir.functions.some((f) => f.generator !== undefined && f.name !== "%main" && !o.comdat.includes(f.name))).map((o) => o.module.tag));
  // The interface-arms analysis is whole-program: objects lowered against different results (an edit changed which
  // classes flow into which structural types) map the same types differently.
  const arms = new Map<string, string[]>();
  for (const o of objects) if (o.module.path !== PROGRAM_DISPATCH_MODULE && o.assumptions.arms !== null) arms.set(o.assumptions.arms, [...(arms.get(o.assumptions.arms) ?? []), o.module.path]);
  if (arms.size > 1) stale(`objects lowered against ${arms.size} interface-arms analyses (${[...arms.values()].map((p) => p.slice(0, 2).join(", ")).join("; ")}): an edit changed which classes flow into structural types`);
  // Deferred module initializers: an object whose code reads another module's binding (static data, prototype) needs
  // that module's object to have materialized its initializer. One left deferred (nothing in its lowering read it)
  // would leave the binding at its storage default.
  for (const object of objects) {
    for (const key of object.assumptions.demands) {
      const owner = byTag.get(initializerTag(key) ?? "");
      if (owner && owner !== object && owner.deferred.includes(key))
        stale(`${object.module.path} reads ${key}, whose initializer ${owner.module.path}'s object left deferred (its program never read it): recompile ${owner.module.path}`);
    }
  }
  // A header-mode object lowered only its own module's bodies: what its dispatchers would enumerate (boxed and
  // constructed classes, property and prototype classes, access forms) must already be in a complete lowering's, or
  // the complete copies the link uses miss what that module's code now does.
  // The reference is the program's dispatcher artifact when the link has one (compileProgramObjects), else a complete lowering.
  const reference = objects.find((o) => o.module.path === PROGRAM_DISPATCH_MODULE) ?? objects.find((o) => o.lowering !== "header");
  if (dispatchers.size > 0 && reference) {
    const known = new Map(Object.entries(reference.assumptions.dispatch).map(([field, names]) => [field, new Set(names)] as const));
    for (const object of objects) {
      if (object.lowering !== "header") continue;
      for (const [field, names] of Object.entries(object.assumptions.dispatch)) {
        const beyond = names.filter((n) => !(known.get(field)?.has(n) ?? false));
        if (beyond.length > 0) stale(`${object.module.path}: its code reaches dispatch entries the program's complete lowering (${reference.module.path}) lacks (${field}: ${beyond.slice(0, 4).join(", ")}${beyond.length > 4 ? ` +${beyond.length - 4}` : ""}): recompile the program's objects (compileProgramObjects)`);
      }
    }
  }
  for (const [name, copies] of dispatchers) {
    const needed = name.startsWith("%dyn.class.") ? classModules : generatorModules;
    // One program revision (the guard above): every non-header copy came from a lowering of the whole program. Only a
    // diagnostic mixed-revision link has copies whose program may have lacked a module: check what each saw.
    const complete = copies.find((c) => c.object.lowering !== "header" && (!opts.acceptMixedRevisions || [...needed].every((t) => c.object.sees.includes(t))));
    if (complete) {
      comdats.set(name, complete);
      // A header-mode copy (a module recompiled alone since) covers what its own module's code boxes, constructs and
      // reads. Everything it names (classes, members, property keys, helpers) must be in the complete copy, or that
      // module's edit reached past what the complete copy dispatches over.
      const covered = new Set<string>();
      namesOf(complete.def.body, covered);
      for (const copy of copies) {
        if (copy.object.lowering !== "header") continue;
        const named = new Set<string>();
        namesOf(copy.def.body, named);
        const beyond = [...named].filter((n) => !covered.has(n)).sort();
        if (beyond.length > 0) stale(`${name}: ${copy.object.module.path}'s copy dispatches over ${beyond.slice(0, 4).join(", ")}${beyond.length > 4 ? ` (+${beyond.length - 4})` : ""}, which ${complete.object.module.path}'s complete copy does not: recompile the program's objects (compileProgramObjects)`);
      }
    } else {
      const missing = [...needed].filter((t) => !copies[0]!.object.sees.includes(t)).map((t) => byTag.get(t)?.module.path ?? t);
      if (missing.length === 0) stale(`${name} (carried by ${copies.map((c) => c.object.module.path).join(", ")}) dispatches over the classes its header-mode lowering reached, not the program's: link-time dispatcher synthesis is not implemented`);
      else stale(`${name} (carried by ${copies.map((c) => c.object.module.path).join(", ")}) dispatches over the classes or generators its object's program saw, not those of ${missing.join(", ")}: link-time dispatcher synthesis is not implemented`);
    }
  }

  // References: each against its definer, with the key the referencing object was compiled against.
  const resolveAll = <T>(object: WasmGcObject, kind: string, refs: Record<string, string>, defs: Map<string, Defined<T>>): void => {
    for (const [name, key] of Object.entries(refs)) {
      const def = defs.get(name);
      const owner = byTag.get(tagOfSymbol(name) ?? tagOfGlobal(name) ?? "");
      if (!def) stale(`${object.module.path}: undefined ${kind} ${name}${owner ? ` (${owner.module.path}'s object does not define it: it predates this use, so recompile ${owner.module.path})` : " (its module's object is not in the link)"}`);
      else if (def.key !== key) stale(`${object.module.path}: ${kind} ${name} was compiled against ${key}, but ${def.object.module.path} defines ${def.key} (a stale object: recompile ${object.module.path})`);
    }
  };
  for (const object of objects) {
    resolveAll(object, "function", object.references.functions, fns);
    resolveAll(object, "class", object.references.classes, classes);
    resolveAll(object, "global", object.references.globals, globals);
  }

  // Class-hierarchy assumptions. A frontend calls a method directly where no class it knows overrides it below the
  // receiver's class, and treats a class with no subclass as exact; a class it did not know, or one that has changed
  // since, can break either, and the call would skip the override. So every object that knew a class must agree on it
  // (an edit to it makes the other objects stale), and must have known each linked subclass of it. A class owned by a
  // linked module is defined by its owner's view. Generic class instances are made where they are used, so they may be
  // missing from another object's view: they are compared where known, not required.
  const viewKey = (v: IrObjectClassView): string => `${v.base ?? ""}\0${v.members.join("\0")}`;
  const authority = new Map<string, { key: string; path: string }>();
  for (const object of objects) {
    for (const view of object.assumptions.hierarchy) {
      if (tagOfSymbol(view.name) === object.module.tag) authority.set(view.name, { key: viewKey(view), path: object.module.path });
    }
  }
  const linkedChildren = new Map<string, string[]>();
  for (const object of objects) {
    for (const view of object.assumptions.hierarchy) {
      if (view.base === undefined || view.instance || tagOfSymbol(view.name) !== object.module.tag) continue;
      linkedChildren.set(view.base, [...(linkedChildren.get(view.base) ?? []), view.name]);
    }
  }
  const seen = new Map<string, { key: string; path: string }>();
  for (const object of objects) {
    const known = new Map(object.assumptions.hierarchy.map((v) => [v.name, v] as const));
    for (const view of known.values()) {
      const truth = authority.get(view.name);
      if (truth) {
        if (truth.key !== viewKey(view)) stale(`${object.module.path} was compiled against another version of class ${view.name} (${truth.path} defines it differently now): recompile ${object.module.path}`);
      } else if (view.instance) {
        const other = seen.get(view.name);
        if (other && other.key !== viewKey(view)) stale(`${object.module.path} and ${other.path} disagree on class ${view.name}: recompile both`);
        seen.set(view.name, { key: viewKey(view), path: object.module.path });
      }
      for (const child of linkedChildren.get(view.name) ?? []) {
        if (!known.has(child)) stale(`${object.module.path} was compiled without ${child} (${authority.get(child)?.path ?? "?"}), a subclass of ${view.name}: its calls on ${view.name} may skip that subclass's overrides (compile it against the whole program: programRoot)`);
      }
    }
  }
  if (problems.length > 0) throw new LinkError(problems, requests);

  const functions: IrFunction[] = [];
  const placedComdats = new Set<string>();
  for (const object of objects) {
    const comdatNames = new Set(object.comdat);
    for (const fn of object.ir.functions) {
      if (fn.name === "%main") { if (object === entry) functions.push(fn); continue; }
      if (comdatNames.has(fn.name)) { if (!placedComdats.has(fn.name)) { placedComdats.add(fn.name); functions.push(comdats.get(fn.name)!.def); } continue; }
      functions.push(fn);
    }
  }
  // A header placeholder (a body another object defines, lowered here only for its signature) never runs: one that
  // reached the link would trap where the whole program runs the body.
  const placeholders = functions.filter((fn) => fn.body.some((st) => st.kind === "runtimeFence" && st.code === HEADER_PLACEHOLDER_CODE));
  if (placeholders.length > 0) throw new LinkError(placeholders.map((fn) => `${fn.name} is a header placeholder (${HEADER_PLACEHOLDER_CODE}), not its body: the object that defines it is missing or did not keep it`));
  if (!functions.some((f) => f.name === "%main")) throw new LinkError([`${entry.module.path}: the entry object has no %main`]);
  const sloppy = [...new Set(objects.flatMap((o) => o.ir.sloppyFiles ?? []))];
  // FFI imports: one declaration per name across the objects (each carries its program's manifest bindings).
  const ffiByName = new Map<string, { object: WasmGcObject; def: IrFfiImport; key: string }>();
  const ffiProblems: string[] = [];
  for (const object of objects) for (const imp of object.ir.ffiImports ?? []) {
    const key = JSON.stringify(imp), prior = ffiByName.get(imp.name);
    if (!prior) ffiByName.set(imp.name, { object, def: imp, key });
    else if (prior.key !== key) ffiProblems.push(`FFI import ${imp.name}: ${object.module.path} declares it differently from ${prior.object.module.path}`);
  }
  if (ffiProblems.length > 0) throw new LinkError(ffiProblems);
  const linked: IrModule = {
    irVersion: entry.ir.irVersion,
    ...(entry.ir.browser ? { browser: true as const } : {}),
    ...(sloppy.length ? { sloppyFiles: sloppy } : {}),
    sourceFile: entry.ir.sourceFile,
    functions,
    classes: basesFirst([...runtimeClasses.values(), ...classes.values(), ...comdatClasses.values()].map((d) => d.def)),
    records: [...records.values()].map((d) => d.def),
    unions: [...unions.values()].map((d) => d.def),
    globals: [...globals.values()].map((d) => d.def),
    entry: entry.ir.entry,
    ...(ffiByName.size ? { ffiImports: [...ffiByName.values()].map((d) => d.def) } : {}),
  };
  // Validation reads the process's target switches (browserTarget, nativeDyn, ...), which only compile() sets: a
  // process that links from a store without compiling first must set them from the objects' own target.
  setBrowserTarget(entry.target.browser);
  setNativeDyn(entry.target.dynModel === "native");
  setNativeAny(entry.target.experimentalTsNativeAny);
  const invalid = validateModule(linked);
  // In a link of reused and recompiled objects, an invalid join is their disagreement (one lowering would agree with
  // itself): a reseed cures it. Otherwise it is a compiler fault.
  if (invalid.length > 0) {
    const messages = invalid.map((v) => `linked IR invalid: ${v.message}`);
    throw new LinkError(messages, opts.reuseValidated ? messages.map((reason) => ({ kind: "reseed" as const, reason })) : []);
  }
  return linked;
}

/** The backend options a whole-program compile() of the same target passes (index.ts), for a dev (0) or release (2)
 * level. */
export function linkEmitOptions(target: ObjectTarget, optimizeLevel: 0 | 2): WasmGcEmitOptions {
  const native = target.browser && target.dynModel === "native";
  return {
    jsFences: true,
    experimentalTsNativeAny: target.experimentalTsNativeAny,
    // Constructor structs are on by default for browser native WasmGC (index.ts).
    experimentalJsConstructorStructs: native,
    optimizeLevel,
    engineDyn: target.browser && !native,
    browser: target.browser,
  };
}

export interface LinkedWasmGc {
  module: IrModule;
  binary: Uint8Array;
  hostImports: string[];
  /** Milliseconds: resolving and joining the objects, emitting the module, and wasm-opt. */
  timings: { link: number; emit: number; optimise: number };
  /** The emitter's phases within `emit` (WasmGcEmitResult.phases). */
  emitPhases?: Record<string, number>;
}

/** Links objects into one runnable WasmGC module. Release (the default, level 2) generates release code and optimises
 * the linked module with optimiseWasmGcBinary at -O2; level 0 is a dev build, unoptimised with names. */
export function linkWasmGc(objects: readonly WasmGcObject[], opts: LinkOptions & { optimizeLevel?: 0 | 2 } = {}): LinkedWasmGc {
  const level = opts.optimizeLevel ?? 2;
  const t0 = performance.now();
  const module = linkObjects(objects, opts);
  const t1 = performance.now();
  const emitted = emitWasmGcModule(module, { ...linkEmitOptions(objects[0]!.target, level), ...(opts.emit ?? {}), ...(level ? { deferOptimisation: true } : {}) });
  const t2 = performance.now();
  const binary = level ? optimiseWasmGcBinary(emitted.binary, level) : emitted.binary;
  const t3 = performance.now();
  return { module, binary, hostImports: emitted.hostImports, timings: { link: t1 - t0, emit: t2 - t1, optimise: t3 - t2 }, ...(emitted.phases ? { emitPhases: emitted.phases } : {}) };
}
