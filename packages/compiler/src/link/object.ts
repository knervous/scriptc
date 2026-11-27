/* Separate compilation, the object writer (docs-draft/OBJECT_FILES_POC.md). An object is one module's typed IR plus a
 * symbol table, the way an LTO object carries bitcode: the frontend lowers the module against its imports' sources
 * (their declarations, class layouts and record shapes, as a C file sees its headers), the writer keeps what the module
 * itself defines, and link.ts joins objects and runs the backend once over the joined IR. GC types are not in the
 * object at all: classes are named by their module's tag, records and unions by their structural key, so the linker
 * merges them by name and the backend emits each type once. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../index.js";
import { DYN_CLASS_PROPERTIES, type IrClassDef, type IrFunction, type IrGlobal, type IrModule, type IrObjectClassView, type IrRecordShape, type IrUnionDef } from "../ir/ir.js";
import { backendRoots, implicitReferences } from "../ir/implicit-references.js";
import { deserializeModule, IR_VERSION, serializeModule } from "../ir/serialize.js";
import { WASMGC_HOST_ABI } from "../backend/wasmgc/emitter.js";
import { HEADER_PLACEHOLDER_CODE, objectModuleHash, objectModulePath, objectModuleTag, type ObjectUnit } from "./module-tag.js";

export const WASMGC_OBJECT_SCHEMA = "scriptc-wasmgc-object/6";

/** The frontend settings an object was lowered under. Objects link only with objects of the same target. */
export interface ObjectTarget {
  browser: boolean;
  dynModel: "engine" | "native";
  experimentalTsNativeAny: boolean;
}

/** Symbols by name, each with its key: a function's signature, a class's layout (base and fields), a global's type. */
export interface ObjectSymbols {
  functions: Record<string, string>;
  classes: Record<string, string>;
  globals: Record<string, string>;
}

export interface WasmGcObject {
  schema: typeof WASMGC_OBJECT_SCHEMA;
  irVersion: number;
  hostAbi: string;
  target: ObjectTarget;
  /** The module: its path relative to the root, its symbol tag and its init function. */
  module: { path: string; tag: string; init: string };
  /** The tags of every module this object's program held (the module itself and its imports, transitively). */
  sees: string[];
  defines: ObjectSymbols;
  /** Symbols of other modules this object's code uses, with the key it was compiled against. */
  references: ObjectSymbols;
  /** Functions every object whose code reaches one carries, as a COMDAT (the linker keeps one copy of each name):
   * untagged keyed helpers (`%arr.map.<hash>`), lambdas (`%fn.<hash>`) and generic instantiations
   * (`%m<hash>.id%<hash>`, instantiated where they are used, as C++ templates are). */
  comdat: string[];
  /** Generic class instantiations (`%m<hash>.Box%<hash>`) and their families, COMDATs too, merged by layout. */
  comdatClasses: string[];
  /** Whole-program facts the frontend decided from: the class hierarchy it lowered against (every class it knew, with
   * base and members). Direct calls where no override exists below a class, exact receivers and leaf classes all hold
   * only while the linked world's hierarchy is this one: the linker refuses any difference. `dispatch` is what the
   * lowering's program-dependent dispatchers enumerate (IrModule.objectDispatch): a header-mode object's must be
   * covered by a complete lowering's in the same link. `demands`: other modules' deferred initializers its code reads. */
  assumptions: { hierarchy: IrObjectClassView[]; dispatch: Record<string, string[]>; demands: string[]; arms: string | null };
  /** What the module's object consumed from source: every file of its read closure (the modules it names,
   * transitively) with the sha256 of the text lowered. A later build may reuse the object while every one is unchanged
   * (link/build.ts buildObjects); the program-wide facts are checked at link. */
  reads: Record<string, string>;
  /** Every unit the lowering knew in this module, reached or not (a recompile against this seed roots any other). */
  units: string[];
  /** The module's deferred initializers this object left unmaterialized (no code of its lowering read them): another
   * object whose code demands one (assumptions.demands) does not link with this one. */
  deferred: string[];
  /** How the frontend lowered the other modules: "header" (signatures only: their bodies, and the classes and members
   * only those bodies reach, are not in this lowering) or "closure" (everything the module's program reaches). */
  lowering: "header" | "closure";
  /** What the object's IR depends on besides other modules' keys (an object cache reuses it while these match): */
  stamp?: ObjectStamp;
  ir: IrModule;
}

/** An object's provenance, FPC's checksums and LLVM's cache key in one: the compiler frontend that lowered it (IR
 * changes invalidate objects; backend changes do not, since the link emits every build), the module's source and the
 * compile options. */
export interface ObjectStamp {
  /** sha256 of the compiler's frontend, IR and link code (frontendDigest). */
  frontend: string;
  /** sha256 of the module's source text, as the lowering read it. */
  source: string;
  /** sha256 of the whole program's text as the lowering read it (IrModule.objectProgram): any source edit changes it. */
  program: string;
  /** sha256 of the compile options (keys sorted) and the object-mode environment switches. */
  options: string;
}

/** Environment switches that change what object-mode lowering produces (header-mode A/B controls). */
const OBJECT_ENV_SWITCHES = ["SCRIPTC_OBJECT_FULL_CLOSURE", "SCRIPTC_OBJECT_HEADER_BODIES"] as const;

let frontendDigestMemo: string | null = null;
/** sha256 over the compiler build's frontend/, ir/ and link/ files and index.js (paths and contents, in path order):
 * the code an object's IR depends on. The backend (backend/) is left out: objects carry IR, so an emitter change needs
 * only a new link. */
export function frontendDigest(): string {
  if (frontendDigestMemo !== null) return frontendDigestMemo;
  const root = fileURLToPath(new URL("../", import.meta.url));
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else hash.update(relative(root, file)).update("\0").update(readFileSync(file)).update("\0");
    }
  };
  for (const part of ["frontend", "ir", "link"]) walk(join(root, part));
  // The compiled build (dist/index.js), or its sources when they run directly (tests).
  const index = ["index.js", "index.ts"].find((name) => { try { return statSync(join(root, name)).isFile(); } catch { return false; } });
  if (index !== undefined) hash.update(`${index}\0`).update(readFileSync(join(root, index)));
  frontendDigestMemo = hash.digest("hex");
  return frontendDigestMemo;
}

const sortedJson = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

export interface CompileObjectOptions {
  /** The directory module paths (and so symbol tags) are relative to. Every object of one link must share it. */
  root: string;
  /** The program's entry: every object of the program lowers against the whole program it roots (the same modules, so
   * the same whole-program analyses), owning only its own module. Without it an object's program is its import closure. */
  programRoot?: string;
  /** Further compile() options the program is built with (hostHandles, wasmLink, ffiProfilePath, conditions, ...), as a
   * whole-program build of it passes them. */
  compileOptions?: Record<string, unknown>;
  /** The module's object from the program's seed (compileProgramObjects): the recompile roots the units it defined
   * and leaves deferred the initializers it left deferred, so both lowerings follow one reached-root policy. */
  seed?: WasmGcObject;
  outPath: string;
  browser?: boolean;
  dynModel?: "engine" | "native";
  experimentalTsNativeAny?: boolean;
}

export class ObjectCompileError extends Error {}

/** A symbol's module tag (`%m<hash>.`), or null for an untagged name. Class members are `%<class>.<member>`, so one or
 * two leading `%`. */
export function tagOfSymbol(name: string): string | null {
  const init = /^%init\.(\d+)$/.exec(name);
  if (init) return `%m${init[1]}.`;
  const tagged = /^%{0,2}([mt]\d+)\./.exec(name);
  return tagged ? `%${tagged[1]}.` : null;
}

/** The module tag of a deferred initializer's key (a binding's global id, `class:<name>`, `prototype:<name>`). */
export function initializerTag(key: string): string | null {
  const cls = /^(?:class|prototype):(.*)$/.exec(key);
  return cls ? tagOfSymbol(cls[1]!) : tagOfGlobal(key);
}

/** Globals that travel with the objects whose code reaches them, as COMDAT functions do, the linker keeping one of each:
 * a class's prototype-data slots (`%g.%prototype.data.<class>` and its `.ready` flag, made by the class's shared
 * `%prototype.data.<class>` helper where code first needs the prototype), and imported bindings with no module of
 * their own (`%g.npm`, `%g.json`, `%g.raw`: npm, JSON and raw-text imports), which object lowerings name by the
 * binding's declaration; and any other untagged global whose id is a keyed hash (a tagged template's strings, ...). */
export function isComdatGlobal(id: string): boolean {
  if (id.startsWith("%g.%prototype.data.") || id.startsWith("%g.npm.") || id.startsWith("%g.json.") || id.startsWith("%g.raw.")) return true;
  // Any other untagged global named by a keyed hash (keyedHelperName/keyedId: the same id in every lowering of its key).
  return tagOfGlobal(id) === null && /\.[0-9a-f]{12}$/.test(id);
}

/** A global's module tag: a module binding is `%g.m<hash>.<name>`; a class's slots (`%g.s.<class>.<name>`,
 * `%g.%prototype.data.<class>.ready`, `%g.<class>.base`) take the tag of the class name they carry. */
export function tagOfGlobal(id: string): string | null {
  const tagged = /^%g\.(?:%?[A-Za-z]+\.)*%?([mt]\d+)\./.exec(id);
  return tagged ? `%${tagged[1]}.` : null;
}

const stripLocs = (key: string, value: unknown): unknown => (key === "loc" ? undefined : value);

/** A generic instantiation's name: the family or function name, then `%` and the 12-hex-digit hash of the type
 * arguments (keyedHelperName's `%` separator), so every object that instantiates it names it alike. */
export function isInstantiation(name: string): boolean {
  return /[^%.]%[0-9a-f]{12}(\.|$)/.test(name);
}

/** A function's link key: what a caller compiled against it relies on. */
export function functionKey(fn: IrFunction): string {
  return JSON.stringify({
    params: fn.params.map((p) => p.type), ret: fn.returnType,
    ...(fn.async ? { async: true } : {}), ...(fn.generator ? { generator: fn.generator } : {}),
    ...(fn.captures ? { captures: fn.captures.map((c) => c.type) } : {}),
    ...(fn.classCaptures ? { classCaptures: fn.classCaptures.map((c) => [c.type, c.slot]) } : {}),
  });
}

/** A class's link key: its layout (the struct a foreign object allocates, reads and casts to). Methods are not part of
 * it: an importer's view keeps only the members it reaches. */
export function classKey(cls: IrClassDef): string {
  return JSON.stringify({ base: cls.base ?? null, fields: cls.fields, ...(cls.localCaptures ? { localCaptures: cls.localCaptures } : {}) });
}

export function globalKey(g: IrGlobal): string {
  return JSON.stringify({ type: g.type, mutable: g.mutable });
}

/** A definition with its source sites removed: two objects' copies of one COMDAT agree on this. */
export function withoutLocs(value: unknown): string {
  return JSON.stringify(value, stripLocs);
}

/** Every string a value holds, keys excluded, and the names its nodes reach by backend convention
 * (implicitReferences): the names an IR fragment refers to. */
function strings(value: unknown, out: Set<string>): void {
  if (typeof value === "string") out.add(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value !== null && typeof value === "object") {
    for (const implicit of implicitReferences(value)) out.add(implicit.name);
    for (const [key, item] of Object.entries(value)) if (key !== "loc") strings(item, out);
  }
}

/** A lowered program indexed once for partitioning: definitions by name (in program order), each module's own
 * definitions by tag, and, memoized per definition, the names it refers to. Partitioning every module of one program
 * (compileProgramObjects) scans each definition once, not once per module that reaches it. */
export interface ProgramIndex {
  mod: IrModule;
  fnByName: Map<string, IrFunction>;
  classByName: Map<string, IrClassDef>;
  globalById: Map<string, IrGlobal>;
  recordById: Map<string, IrRecordShape>;
  unionById: Map<string, IrUnionDef>;
  /** Program order of every definition, by name or id (an object keeps its definitions in it). */
  order: Map<string, number>;
  /** Generic class families (never constructed): they ride with their instantiations. */
  families: Set<string>;
  ownFns: Map<string, IrFunction[]>;
  ownClasses: Map<string, IrClassDef[]>;
  /** Every class carrying the tag (instantiations and families too): the closure scan starts from them. */
  taggedClasses: Map<string, IrClassDef[]>;
  ownGlobals: Map<string, IrGlobal[]>;
  /** Module tags whose `%loaded` flag the program has: the modules every object of the program saw. */
  sees: string[];
  names(value: unknown): readonly string[];
}

export function indexProgram(mod: IrModule): ProgramIndex {
  for (const fn of mod.functions) {
    const t = tagOfSymbol(fn.name);
    if (t !== null && t.startsWith("%t")) throw new ObjectCompileError(`${fn.name}: type-only class modules are not supported by objects yet`);
  }
  // FFI import declarations ride the object as the whole-program build has them (one manifest for the program): the
  // linker joins them by name, and two objects declaring one import differently do not link.
  if (mod.embedded || mod.lib) throw new ObjectCompileError("objects do not carry embedded npm graphs or library sections yet");
  const order = new Map<string, number>();
  const byTag = <T>(items: readonly T[], tagOf: (item: T) => string | null, keep: (item: T) => boolean = () => true): Map<string, T[]> => {
    const out = new Map<string, T[]>();
    for (const item of items) {
      const t = tagOf(item);
      if (t !== null && keep(item)) out.set(t, [...(out.get(t) ?? []), item]);
    }
    return out;
  };
  const listed = <T>(items: readonly T[], key: (item: T) => string): Map<string, T> => new Map(items.map((item, i) => { order.set(key(item), i); return [key(item), item] as const; }));
  const families = new Set((mod.classes ?? []).flatMap((c) => (c.genericOf === undefined ? [] : [c.genericOf])));
  const memo = new WeakMap<object, string[]>();
  return {
    mod, order, families,
    fnByName: listed(mod.functions, (f) => f.name),
    classByName: listed(mod.classes ?? [], (c) => c.name),
    globalById: listed(mod.globals ?? [], (g) => g.id),
    recordById: listed(mod.records ?? [], (r) => r.id),
    unionById: listed(mod.unions ?? [], (u) => u.id),
    ownFns: byTag(mod.functions, (f) => tagOfSymbol(f.name), (f) => !isInstantiation(f.name)),
    ownClasses: byTag(mod.classes ?? [], (c) => tagOfSymbol(c.name), (c) => c.genericOf === undefined && !families.has(c.name)),
    taggedClasses: byTag(mod.classes ?? [], (c) => tagOfSymbol(c.name)),
    ownGlobals: byTag(mod.globals ?? [], (g) => tagOfGlobal(g.id), (g) => !isComdatGlobal(g.id)),
    sees: [...new Set((mod.globals ?? []).filter((g) => g.name === "%loaded").map((g) => tagOfGlobal(g.id)).filter((t): t is string => t !== null))].sort(),
    names(value: unknown): readonly string[] {
      if (value === null || typeof value !== "object") return typeof value === "string" ? [value] : [];
      let out = memo.get(value);
      if (!out) { const found = new Set<string>(); strings(value, found); out = [...found]; memo.set(value, out); }
      return out;
    },
  };
}

export interface PartitionOptions {
  /** Whether this object is the program entry's: it alone carries the program's `%main`. Default: whichever object's
   * lowering has a real `%main` body (a header-mode object of another module has a placeholder). */
  entry?: boolean;
  /** WasmGcObject.lowering. Default "header" (with SCRIPTC_OBJECT_FULL_CLOSURE=1, "closure"). */
  lowering?: "header" | "closure";
  /** COMDAT functions the object carries (with their closure) though its own code need not reach them. */
  comdatRoots?: readonly string[];
}

/** Program-enumerating dispatchers (`%dyn.class.*`, `%dyn.generator.*`): bodies that list the program's classes or
 * generators, right only as complete as the lowering that made them. */
export const enumeratesProgram = (name: string): boolean => /^%dyn\.(class|generator)\./.test(name);

/** The object compileProgramObjects adds for the program's dispatchers: no module of its own. Its path holds a NUL, which
 * no source path can, so it never shares a module path or tag with a source module. */
export const PROGRAM_DISPATCH_MODULE = "\u0000program";
/** Where compileProgramObjects writes the program artifact: a source module's object path is always escaped
 * (objectFilePath), so no source path maps here. */
export const PROGRAM_DISPATCH_FILE = "%program.wobj";

/** Splits a module's lowered program (the module plus everything it imports) into its object: the module's own
 * functions, classes and globals, the COMDAT helpers its code reaches, the records and unions it uses, and the foreign
 * symbols it references with the keys it was compiled against. */
export function partitionObject(program: IrModule | ProgramIndex, unit: ObjectUnit, file: string, target: ObjectTarget, opts: PartitionOptions = {}): WasmGcObject {
  const index = "mod" in program && "names" in program ? program : indexProgram(program);
  const { mod, fnByName, classByName, globalById, recordById, unionById, families } = index;
  const tag = objectModuleTag(unit, file);
  const init = `%init.${objectModuleHash(unit, file)}`;

  // The program's %main is the program root's (a header stub in every other object of a program-rooted build).
  const isHeaderStub = (f: IrFunction): boolean => f.body.length === 1 && f.body[0]!.kind === "runtimeFence" && f.body[0]!.code === HEADER_PLACEHOLDER_CODE;
  const main = fnByName.get("%main");
  const ownsMain = main !== undefined && (opts.entry ?? !isHeaderStub(main));
  const own = [...(ownsMain ? [main] : []), ...(index.ownFns.get(tag) ?? [])];
  // Generic instances are named by a hash of their instantiation key (keyedHelperName), the same in every object that
  // reaches them: COMDATs.
  const keptFns = new Map(own.map((f) => [f.name, f]));
  const comdat: string[] = [], comdatClasses = new Set<string>();
  const keptRecords = new Map<string, IrRecordShape>(), keptUnions = new Map<string, IrUnionDef>(), comdatGlobals = new Map<string, IrGlobal>();
  const refFns = new Map<string, IrFunction>(), refClasses = new Map<string, IrClassDef>(), refGlobals = new Map<string, IrGlobal>();
  const ownClasses = index.ownClasses.get(tag) ?? [], ownGlobals = index.ownGlobals.get(tag) ?? [];
  // The closure of what the module's code names: COMDAT functions join the object (and are scanned in turn), foreign
  // tagged symbols become references, records and unions join with the shapes their fields name.
  const pending: unknown[] = [...own, ...(index.taggedClasses.get(tag) ?? []), ...ownGlobals];
  const seen = new Set<string>(), untagged = new Set<string>();
  for (const name of opts.comdatRoots ?? []) {
    const fn = fnByName.get(name);
    if (!fn || keptFns.has(name)) continue;
    seen.add(name); keptFns.set(name, fn); comdat.push(name); pending.push(fn);
  }
  while (pending.length > 0) {
    for (const name of index.names(pending.pop())) {
      if (seen.has(name)) continue;
      seen.add(name);
      const fn = fnByName.get(name);
      if (fn && !keptFns.has(name)) {
        const t = tagOfSymbol(name);
        if (t === null || isInstantiation(name)) { keptFns.set(name, fn); comdat.push(name); pending.push(fn); }
        else if (t !== tag) refFns.set(name, fn);
      }
      const cls = classByName.get(name);
      if (cls && (cls.genericOf !== undefined || isInstantiation(name) || families.has(name))) {
        comdatClasses.add(name); pending.push(cls);
        // Its methods are its vtable's (the backend emits every one the class lists), called or not: they travel with it.
        for (const method of cls.methods ?? []) {
          const member = `%${name}.${method}`, memberFn = fnByName.get(member);
          if (memberFn && !keptFns.has(member)) { seen.add(member); keptFns.set(member, memberFn); comdat.push(member); pending.push(memberFn); }
        }
      }
      else if (cls && tagOfSymbol(name) !== tag) {
        if (tagOfSymbol(name) !== null) refClasses.set(name, cls);
        pending.push(cls.fields, cls.base ?? null);
      }
      const g = globalById.get(name);
      if (g && isComdatGlobal(name)) comdatGlobals.set(name, g);
      else if (g && tagOfGlobal(name) !== tag) {
        if (tagOfGlobal(name) === null) untagged.add(name.replace(/\.[^.]*$/, ".*"));
        else refGlobals.set(name, g);
      }
      const rec = recordById.get(name);
      if (rec && !keptRecords.has(name)) { keptRecords.set(name, rec); pending.push(rec); }
      const un = unionById.get(name);
      if (un && !keptUnions.has(name)) { keptUnions.set(name, un); pending.push(un); }
    }
  }
  if (untagged.size > 0) throw new ObjectCompileError(`untagged module globals are not supported by objects yet: ${[...untagged].sort().join(", ")}`);
  const inOrder = <T>(items: Iterable<T>, key: (item: T) => string): T[] =>
    [...items].sort((a, b) => (index.order.get(key(a)) ?? 0) - (index.order.get(key(b)) ?? 0));
  const fns = inOrder(keptFns.values(), (f) => f.name);
  const { objectHierarchy: _hierarchy, objectSource: _source, objectProgram: _program, objectFiles: _files, objectDispatch: _dispatch, objectDeferred: _deferred, objectDemands: _demands, objectSources: _sources, objectReads: _reads, objectArms: _arms, objectUnits: _units, ...irWithoutHierarchy } = mod;
  // Runtime-provided classes (the Error hierarchy) ride every module: every object carries them, as COMDATs.
  const runtimeClasses = (mod.classes ?? []).filter((c) => c.runtime === true);
  const classes = inOrder(new Set([...comdatClasses].map((name) => classByName.get(name)!).concat(ownClasses, runtimeClasses)), (c) => c.name);
  const symbols = (fnList: Iterable<IrFunction>, classList: Iterable<IrClassDef>, globalList: Iterable<IrGlobal>): ObjectSymbols => ({
    functions: Object.fromEntries([...fnList].map((f) => [f.name, functionKey(f)])),
    classes: Object.fromEntries([...classList].map((c) => [c.name, classKey(c)])),
    globals: Object.fromEntries([...globalList].map((g) => [g.id, globalKey(g)])),
  });
  return {
    schema: WASMGC_OBJECT_SCHEMA,
    irVersion: IR_VERSION,
    hostAbi: WASMGC_HOST_ABI,
    target,
    module: { path: objectModulePath(unit, file), tag, init },
    sees: index.sees,
    defines: symbols(own.filter((f) => f.name !== "%main"), classes.filter((c) => !c.runtime && !comdatClasses.has(c.name)), ownGlobals),
    references: symbols(refFns.values(), refClasses.values(), refGlobals.values()),
    comdat: comdat.sort(),
    comdatClasses: [...comdatClasses].sort(),
    assumptions: { hierarchy: mod.objectHierarchy ?? [], dispatch: mod.objectDispatch ?? {}, demands: mod.objectDemands ?? [], arms: mod.objectArms ?? null },
    reads: Object.fromEntries((mod.objectReads?.[file] ?? []).map((f) => [f, mod.objectSources?.[f] ?? ""] as const)),
    units: (mod.objectUnits ?? []).filter((name) => tagOfSymbol(name) === tag),
    deferred: (mod.objectDeferred ?? []).filter((key) => initializerTag(key) === tag),
    lowering: opts.lowering ?? (process.env["SCRIPTC_OBJECT_FULL_CLOSURE"] === "1" ? "closure" : "header"),
    ir: {
      ...irWithoutHierarchy,
      functions: fns,
      classes,
      globals: inOrder([...ownGlobals, ...comdatGlobals.values()], (g) => g.id),
      records: inOrder(keptRecords.values(), (r) => r.id),
      unions: inOrder(keptUnions.values(), (u) => u.id),
    },
  };
}

/** Compiles one module to an object: the frontend lowers it (as the entry of its own import graph, every file tagged by
 * its path under `root`), and partitionObject keeps what the module defines. */
export async function compileObject(sourcePath: string, opts: CompileObjectOptions): Promise<WasmGcObject> {
  const file = resolve(sourcePath), root = resolve(opts.root), target = objectTarget(opts);
  const dir = await mkdtemp(join(tmpdir(), "wasmgc-object-"));
  try {
    const irPath = join(dir, "module.ir.json");
    const unit: ObjectUnit = opts.programRoot !== undefined ? { root, module: file } : { root };
    if (opts.seed) { unit.roots = [...Object.keys(opts.seed.defines.functions)].sort(); unit.deferred = opts.seed.deferred; unit.knownUnits = opts.seed.units; unit.seedBagClasses = seedBagClasses(opts.seed); }
    const r = await compile(opts.programRoot !== undefined ? resolve(opts.programRoot) : file, {
      ...(opts.compileOptions ?? {}),
      outDir: dir, outPath: irPath, outputKind: "ir", objectUnit: unit,
      browser: target.browser, dynModel: target.dynModel, ...(target.experimentalTsNativeAny ? { experimentalTsNativeAny: true } : {}),
    });
    if (!r.ok) throw new ObjectCompileError(`${sourcePath}: ${r.diagnostics.map((d) => d.message).join("; ")}`);
    const mod = deserializeModule(await readFile(irPath, "utf8"));
    const { objectSource, objectProgram } = mod;
    if (objectSource === undefined || objectProgram === undefined) throw new ObjectCompileError(`${sourcePath}: the frontend recorded no source revision`);
    // The stamp is the text the lowering read. A file that no longer has it changed during the build (or the compiler
    // read a stale copy): such an object is not published.
    if (createHash("sha256").update(await readFile(file, "utf8")).digest("hex") !== objectSource)
      throw new ObjectCompileError(`${sourcePath}: changed on disk while it compiled (the object would carry the old text): recompile it`);
    const object = partitionObject(mod, unit, file, target);
    object.stamp = { frontend: frontendDigest(), source: objectSource, program: objectProgram, options: optionsStamp(target, root, opts.programRoot, opts.compileOptions) };
    await writeFile(opts.outPath, writeObject(object));
    return object;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Where compileProgramObjects writes a module's object under its outDir: its path under the root with `.wobj` after the
 * full name (`lib.ts` and `lib.mts` stay apart). Injective: each `%` in a segment is escaped as `%25` first, then a `..`
 * segment becomes `%up` (so a module outside the root stays inside the directory, and a literal `%up` folder is `%25up`);
 * no source module can map onto PROGRAM_DISPATCH_FILE. */
export function objectFilePath(modulePath: string): string {
  return modulePath.split(/[\\/]/).map((part) => (part === ".." ? "%up" : part.split("%").join("%25"))).join("/") + ".wobj";
}

/** The classes an object's layouts (the ones it defines and the ones it was compiled against) give a property bag. */
function seedBagClasses(seed: WasmGcObject): string[] {
  const out: string[] = [];
  for (const table of [seed.defines.classes, seed.references.classes]) {
    for (const [name, key] of Object.entries(table)) {
      const layout = JSON.parse(key) as { fields?: { name: string }[] };
      if (layout.fields?.some((f) => f.name === DYN_CLASS_PROPERTIES)) out.push(name);
    }
  }
  return out.sort();
}

/** The target an object options record selects. */
export function objectTarget(opts: { browser?: boolean; dynModel?: "engine" | "native"; experimentalTsNativeAny?: boolean }): ObjectTarget {
  return { browser: opts.browser ?? true, dynModel: opts.dynModel ?? "native", experimentalTsNativeAny: opts.experimentalTsNativeAny ?? false };
}

/** ObjectStamp.options: one hash for every object of one program build, whichever path compiled it (compileObject and
 * compileProgramObjects agree, so their objects link together). */
export function optionsStamp(target: ObjectTarget, root: string, programRoot: string | undefined, compileOptions: Record<string, unknown> | undefined): string {
  const env = Object.fromEntries(OBJECT_ENV_SWITCHES.map((name) => [name, process.env[name] ?? null]));
  return createHash("sha256").update(sortedJson({ target, env, programRoot: programRoot !== undefined ? relative(root, resolve(programRoot)) : null, ...(compileOptions ?? {}) })).digest("hex");
}

export interface CompileProgramObjectsOptions extends Omit<CompileObjectOptions, "outPath" | "programRoot" | "seed"> {
  /** Where the objects go: each module's at its path under `root` (objectFilePath). */
  outDir: string;
  /** Each object as it is partitioned, in place of writing it (nothing is written or kept): a consumer that streams or
   * measures them. */
  onObject?: (file: string, object: WasmGcObject) => void;
}

/** Every module's object from ONE lowering of the program rooted at `entry` (ThinLTO's backend split, §12 step 3): no
 * headers, every module's declarations and initializers lowered, partitioned per module from one index. The objects are
 * the ones compileObject would give each module with `programRoot: entry`, except that their program-dependent
 * dispatchers are complete (lowering "closure"): a later header-mode recompile of one module links against them. */
export async function compileProgramObjects(entry: string, opts: CompileProgramObjectsOptions): Promise<{ file: string; path: string; object: WasmGcObject }[]> {
  const programRoot = resolve(entry), root = resolve(opts.root), target = objectTarget(opts);
  const dir = await mkdtemp(join(tmpdir(), "wasmgc-objects-"));
  try {
    const unit: ObjectUnit = { root, module: programRoot, mode: "program" };
    let lowered: IrModule | null = null;
    // The program's IR stays in memory: a whole client's is longer than V8's longest string as JSON.
    const r = await compile(programRoot, {
      ...(opts.compileOptions ?? {}),
      outDir: dir, outPath: join(dir, "program.ir.json"), outputKind: "ir", objectUnit: unit, objectIrSink: (m: IrModule) => { lowered = m; },
      browser: target.browser, dynModel: target.dynModel, ...(target.experimentalTsNativeAny ? { experimentalTsNativeAny: true } : {}),
    });
    if (!r.ok) throw new ObjectCompileError(`${entry}: ${r.diagnostics.map((d) => d.message).join("; ")}`);
    if (lowered === null) throw new ObjectCompileError(`${entry}: the compiler returned no IR`);
    const mod: IrModule = lowered;
    const { objectFiles, objectProgram } = mod;
    if (objectFiles === undefined || objectProgram === undefined) throw new ObjectCompileError(`${entry}: the frontend recorded no source revision`);
    // Every module the program tags, those outside `root` too (path-mapped packages: their paths start with `../`).
    const files = Object.keys(objectFiles).sort();
    // Every module's text is the one lowered, or nothing is published (see compileObject).
    const changed: string[] = [];
    for (const file of files) if (createHash("sha256").update(await readFile(file, "utf8")).digest("hex") !== objectFiles[file]) changed.push(relative(root, file));
    if (changed.length > 0) throw new ObjectCompileError(`${changed.join(", ")}: changed on disk while the program compiled (the objects would carry the old text): recompile`);
    const index = indexProgram(mod), options = optionsStamp(target, root, programRoot, opts.compileOptions), frontend = frontendDigest();
    const out: { file: string; path: string; object: WasmGcObject }[] = [];
    // Every object's file, the program artifact's too, is distinct before anything is written.
    const planned = new Map<string, string>([[PROGRAM_DISPATCH_FILE, PROGRAM_DISPATCH_MODULE]]);
    for (const file of files) {
      const rel = objectFilePath(relative(root, file)), prior = planned.get(rel);
      if (prior !== undefined) throw new ObjectCompileError(`${relative(root, file)} and ${prior} would write one object file (${rel})`);
      planned.set(rel, relative(root, file));
    }
    for (const file of files) {
      const object = partitionObject(index, { root, module: file }, file, target, { entry: file === programRoot, lowering: "closure" });
      object.stamp = { frontend, source: objectFiles[file]!, program: objectProgram, options };
      const path = join(resolve(opts.outDir), objectFilePath(relative(root, file)));
      if (opts.onObject) { opts.onObject(file, object); continue; }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, writeObject(object));
      out.push({ file, path, object });
    }
    // The program's dispatchers, complete, in an object of their own: a module recompiled alone (header mode) carries
    // partial copies, and the link needs a complete one even when that module's object was their only other carrier.
    // With them, every function the backend roots by convention (no IR node names it): a link reaches each as a whole
    // program does, whichever modules were recompiled.
    const conventional = new Set(backendRoots({ hostHandles: true }));
    const dispatchers = mod.functions.filter((f) => enumeratesProgram(f.name) || conventional.has(f.name)).map((f) => f.name);
    if (dispatchers.length > 0) {
      const file = join(root, PROGRAM_DISPATCH_MODULE);
      const object = partitionObject(index, { root, module: file }, file, target, { entry: false, lowering: "closure", comdatRoots: dispatchers });
      object.stamp = { frontend, source: objectProgram, program: objectProgram, options };
      const path = join(resolve(opts.outDir), PROGRAM_DISPATCH_FILE);
      if (opts.onObject) { opts.onObject(file, object); return out; }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, writeObject(object));
      out.push({ file, path, object });
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Rewrites every source site's file (`loc: { file, start, end }`) in a plain JSON tree. */
function mapLocFiles(value: unknown, map: (file: unknown) => unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => mapLocFiles(item, map));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "loc" && item !== null && typeof item === "object" && "file" in item) {
      const loc: Record<string, unknown> = { ...item };
      loc["file"] = map(loc["file"]);
      out[key] = loc;
    } else out[key] = mapLocFiles(item, map);
  }
  return out;
}

/** An object's bytes: JSON, its IR in the IR serializer's form (whose sentinels keep NaN, infinities and -0), each
 * source site's file an index into `files` (sites are most of an object's IR, and they name few files). */
export function writeObject(object: WasmGcObject): string {
  const files: string[] = [], index = new Map<string, number>();
  const ir = mapLocFiles(JSON.parse(serializeModule(object.ir, true)), (file) => {
    if (typeof file !== "string") return file;
    let i = index.get(file);
    if (i === undefined) { i = files.length; index.set(file, i); files.push(file); }
    return i;
  });
  return JSON.stringify({ ...object, files, ir });
}

/** Reads an object back, refusing another schema or IR version. */
export async function readObject(path: string): Promise<WasmGcObject> {
  const text = await readFile(path, "utf8");
  const head = JSON.parse(text) as { schema?: unknown; irVersion?: unknown };
  if (head.schema !== WASMGC_OBJECT_SCHEMA) throw new ObjectCompileError(`${path}: not a ${WASMGC_OBJECT_SCHEMA} object`);
  if (head.irVersion !== IR_VERSION) throw new ObjectCompileError(`${path}: IR version ${String(head.irVersion)}, this compiler reads ${IR_VERSION}`);
  // The IR's numbers carry the serializer's sentinels (NaN, infinities, -0): its reader restores them.
  const stored = JSON.parse(text) as WasmGcObject & { files: string[]; ir: unknown };
  const { files, ir, ...object } = stored;
  return { ...object, ir: deserializeModule(JSON.stringify(mapLocFiles(ir, (file) => (typeof file === "number" ? files[file] : file)))) };
}
