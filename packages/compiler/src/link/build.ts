/** A build over objects (docs-draft/OBJECT_FILES_POC.md §15.4): recompile the edited modules against the program's
 * seed and link; when the link asks for a reseed (LinkError.requests: the objects no longer describe one program),
 * lower the current program once and link again. A link that still fails after reseeding is reported, never retried:
 * the same sources would give the same objects. */
import { LinkError, linkObjects, linkWasmGc, type LinkOptions } from "./link.js";
import { compileObject, compileProgramObjects, ObjectCompileError, objectTarget, optionsStamp, PROGRAM_DISPATCH_MODULE, readObject, type CompileProgramObjectsOptions, type WasmGcObject } from "./object.js";
import { createHash } from "node:crypto";
import { emitLinkedWasmGc } from "../index.js";
import { readSeed, SeedStoreMiss, writeSeed } from "./store.js";
import type { CompileRequestOptions, CompileRequestResult } from "../compile-types.js";
import { dirname, join, relative, resolve } from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";

export interface SeededProgram { file: string; path: string; object: WasmGcObject }

export interface BuildObjectsOptions extends CompileProgramObjectsOptions {
  /** The program's seed from an earlier build, if any. */
  seed?: readonly SeededProgram[];
  /** A persistent seed store (link/store.ts): read the latest seed from it when no seed is given (a miss reseeds), and
   * write every reseed back to it. */
  store?: string;
  /** Modules (absolute paths) edited since that seed: recompiled alone, in header mode, against it. */
  edited?: readonly string[];
  link?: Omit<LinkOptions, "revision" | "acceptMixedRevisions">;
}

export interface BuildObjectsResult {
  seed: SeededProgram[];
  binary: Uint8Array;
  /** Why the build reseeded (the link's requests), or null when the seed and recompiles linked as they were. */
  reseeded: string[] | null;
  /** Objects recompiled against the seed (their read sets changed); the rest were reused. */
  recompiled?: number;
  /** Where the time went, in ms: reading the seed store, recompiling, writing the store, then the link proper (join),
   * emission (with the emitter's own phases) and wasm-opt. */
  phases?: { readSeedMs: number; recompileMs: number; storeWriteMs: number; joinMs: number; emitMs: number; optimiseMs: number; emitPhases?: Record<string, number> };
}

export class ObjectBuildError extends Error {
  constructor(message: string, readonly problems: readonly string[]) { super(`${message}:\n  ${problems.join("\n  ")}`); }
}

export async function buildObjects(entry: string, opts: BuildObjectsOptions): Promise<BuildObjectsResult> {
  const root = resolve(opts.root);
  const link = (objects: readonly WasmGcObject[], revision: string | undefined) =>
    linkWasmGc(objects, { entry: relative(root, resolve(entry)).split("\\").join("/"), ...(opts.link ?? {}), ...(revision !== undefined ? { revision } : {}) });
  const reseedAndLink = async (why: string[]): Promise<BuildObjectsResult> => {
    const { seed: _old, edited: _edited, link: _link, store: _store, ...programOptions } = opts;
    // In memory: a seed's objects are only ever written as the store's unique blobs (a whole client's object files
    // would be gigabytes of copies).
    const seed: SeededProgram[] = [];
    await compileProgramObjects(entry, { ...programOptions, onObject: (file, object) => { seed.push({ file, path: "", object }); } });
    if (opts.store) await writeSeed(opts.store, seed.map((s) => s.object));
    const revision = seed[0]?.object.stamp?.program;
    try { return { seed, binary: link(seed.map((s) => s.object), revision).binary, reseeded: why }; }
    catch (e) {
      if (!(e instanceof LinkError)) throw e;
      throw new ObjectBuildError("the program's objects do not link even freshly seeded", e.problems);
    }
  };
  let previous = opts.seed;
  let t = performance.now();
  if (!previous && opts.store) {
    try { previous = (await readSeed(opts.store)).map((object) => ({ file: resolve(root, object.module.path), path: "", object })); }
    catch (e) { if (!(e instanceof SeedStoreMiss)) throw e; }
  }
  if (!previous) return reseedAndLink(["no seed"]);
  const readSeedMs = Math.round(performance.now() - t);
  t = performance.now();
  // Which objects the sources still describe: every file an object read (its read set) must have the digest it was
  // read at. One whose read set changed is recompiled against its seed object; the rest are reused as they are. The
  // program artifact's dispatchers are validated at link (dispatch state) instead.
  const edited = new Set((opts.edited ?? []).map((f) => resolve(f)));
  const digests = new Map<string, string | null>();
  const current = async (file: string): Promise<string | null> => {
    if (!digests.has(file)) {
      try { digests.set(file, createHash("sha256").update(await readFile(file, "utf8")).digest("hex")); } catch { digests.set(file, null); }
    }
    return digests.get(file)!;
  };
  const stale = async (s: SeededProgram): Promise<boolean> => {
    if (edited.has(resolve(s.file))) return true;
    if (s.object.module.path === PROGRAM_DISPATCH_MODULE) return false;
    for (const [file, digest] of Object.entries(s.object.reads)) if ((await current(file)) !== digest) return true;
    return false;
  };
  const dir = await mkdtemp(join(tmpdir(), "wasmgc-build-"));
  const objects: WasmGcObject[] = [];
  let recompiled = 0;
  for (const s of previous) {
    if (!(await stale(s))) { objects.push(s.object); continue; }
    const outPath = join(dir, `${objects.length}.wobj`);
    await compileObject(s.file, {
      root: opts.root, programRoot: entry, seed: s.object, outPath,
      ...(opts.compileOptions ? { compileOptions: opts.compileOptions } : {}), ...(opts.browser !== undefined ? { browser: opts.browser } : {}),
      ...(opts.dynModel ? { dynModel: opts.dynModel } : {}), ...(opts.experimentalTsNativeAny !== undefined ? { experimentalTsNativeAny: opts.experimentalTsNativeAny } : {}),
    });
    objects.push(await readObject(outPath));
    recompiled++;
  }
  // Every object here was validated against the current sources (its read set unchanged) or recompiled from them, so
  // a set of several revisions (this build's recompiles, or an earlier build's validated mix) links; every other
  // check still runs.
  const linkMixed = (list: readonly WasmGcObject[]) => linkWasmGc(list, { entry: relative(root, resolve(entry)).split("\\").join("/"), ...(opts.link ?? {}), reuseValidated: true });
  const recompileMs = Math.round(performance.now() - t);
  t = performance.now();
  // The set is the next build's seed: its objects' read sets are what the next edit is checked against. It is stored
  // before linking, as a reseed is (the link and emit must never be able to change what the store holds).
  const next = previous.map((s, i) => (objects[i] === s.object ? s : { file: s.file, path: "", object: objects[i]! }));
  if (opts.store && recompiled > 0) await writeSeed(opts.store, objects, objects.find((o, i) => o !== previous[i]!.object)?.stamp?.program);
  const storeWriteMs = Math.round(performance.now() - t);
  try {
    const linked = linkMixed(objects), ms = (v: number) => Math.round(v);
    return { seed: next, binary: linked.binary, reseeded: null, recompiled, phases: { readSeedMs, recompileMs, storeWriteMs,
      joinMs: ms(linked.timings.link), emitMs: ms(linked.timings.emit), optimiseMs: ms(linked.timings.optimise), ...(linked.emitPhases ? { emitPhases: linked.emitPhases } : {}) } };
  }

  catch (e) {
    if (!(e instanceof LinkError) || e.requests.length === 0) throw e;
    return reseedAndLink(e.requests.map((r) => r.reason));
  }
}

export interface LinkProgramResult {
  binary: Uint8Array;
  objects: number;
  /** Lowering and partitioning (compileProgramObjects), then link and emit, in ms. */
  seedMs: number;
  linkMs: number;
  /** Sharing: COMDAT references across every object, the distinct COMDAT definitions they name, and the joined
   * program's functions (each definition held once in memory however many objects carry it). */
  comdatReferences: number;
  uniqueComdats: number;
  linkedFunctions: number;
}

/** One lowering of the program, partitioned into every module's object and linked in the same process: the objects
 * share the lowering's definitions (nothing is serialized), so memory stays near one program's IR however many objects
 * reach a shared definition. */
export async function linkProgram(entry: string, opts: Omit<CompileProgramObjectsOptions, "onObject"> & { link?: Omit<LinkOptions, "revision" | "acceptMixedRevisions"> }): Promise<LinkProgramResult> {
  const objects: WasmGcObject[] = [];
  const { link: linkOptions, ...programOptions } = opts;
  let t = performance.now();
  await compileProgramObjects(entry, { ...programOptions, onObject: (_file, object) => { objects.push(object); } });
  const seedMs = performance.now() - t;
  t = performance.now();
  const root = resolve(opts.root);
  const revision = objects[0]?.stamp?.program;
  const linked = linkWasmGc(objects, { entry: relative(root, resolve(entry)).split("\\").join("/"), ...(linkOptions ?? {}), ...(revision !== undefined ? { revision } : {}) });
  const comdatReferences = objects.reduce((n, o) => n + o.comdat.length, 0);
  const uniqueComdats = new Set(objects.flatMap((o) => o.comdat)).size;
  return { binary: linked.binary, objects: objects.length, seedMs: Math.round(seedMs), linkMs: Math.round(performance.now() - t),
    comdatReferences, uniqueComdats, linkedFunctions: linked.module.functions.length };
}

export interface WriteLinkedBuildOptions {
  /** The program root the objects were lowered from, and the root their module paths are relative to. */
  entry: string;
  root: string;
  /** The build request's program revision (LinkOptions.revision). */
  revision?: string;
  /** The compile options the objects were lowered with (CompileObjectOptions.compileOptions), now the build's: target,
   * release, optimization, hostHandles, wasmLink, sourceMap, ... */
  compileOptions?: Record<string, unknown>;
  browser?: boolean;
  dynModel?: "engine" | "native";
  experimentalTsNativeAny?: boolean;
  outPath: string;
}

/** Links objects and builds the joined program as a whole-program compile() of the same sources and options would:
 * the same release refusals, emitter options and artifacts (index.ts emitWasmGcArtifacts). The options must be those
 * the objects were lowered with (their stamp's options hash), or the link is refused. */
export async function writeLinkedBuild(objects: readonly WasmGcObject[], opts: WriteLinkedBuildOptions): Promise<CompileRequestResult> {
  const root = resolve(opts.root), target = objectTarget(opts);
  const expected = optionsStamp(target, root, resolve(opts.entry), opts.compileOptions);
  const differing = objects.filter((o) => o.stamp && o.stamp.options !== expected).map((o) => o.module.path);
  if (differing.length > 0) throw new LinkError([`${differing.slice(0, 4).join(", ")}${differing.length > 4 ? ` (+${differing.length - 4})` : ""}: lowered with other options than this build's`]);
  const linked = linkObjects(objects, { entry: relative(root, resolve(opts.entry)).split("\\").join("/"), ...(opts.revision !== undefined ? { revision: opts.revision } : {}) });
  const options: CompileRequestOptions = {
    ...(opts.compileOptions ?? {}), outDir: dirname(resolve(opts.outPath)), outPath: resolve(opts.outPath), outputKind: "wasmgc",
    browser: target.browser, dynModel: target.dynModel, ...(target.experimentalTsNativeAny ? { experimentalTsNativeAny: true } : {}),
  };
  return emitLinkedWasmGc(linked, options);
}

/** compile(entry, options) through objects: one lowering partitioned into every module's object in memory, linked, and
 * built by the shared emission (writeLinkedBuild). Takes the options a whole-program compile() of the same build takes
 * and returns its result shape, so a build script can use either path. */
export async function compileThroughObjects(entry: string, options: CompileRequestOptions & { root: string }): Promise<CompileRequestResult> {
  const { root, outDir: _outDir, outPath, outputKind: _kind, browser, dynModel, experimentalTsNativeAny, ...rest } = options;
  const compileOptions: Record<string, unknown> = { ...rest };
  const target = { ...(browser !== undefined ? { browser } : {}), ...(dynModel !== undefined ? { dynModel } : {}), ...(experimentalTsNativeAny !== undefined ? { experimentalTsNativeAny } : {}) };
  const objects: WasmGcObject[] = [];
  try {
    await compileProgramObjects(entry, { root, outDir: dirname(resolve(outPath)), compileOptions, ...target, onObject: (_file, object) => { objects.push(object); } });
  } catch (e) {
    if (e instanceof ObjectCompileError) return { ok: false, diagnostics: [{ code: "SC3002", message: e.message, loc: { file: entry, start: 0, end: 0 } }], sourceTexts: new Map() };
    throw e;
  }
  return writeLinkedBuild(objects, { entry, root, compileOptions, outPath, ...target, ...(objects[0]?.stamp ? { revision: objects[0].stamp.program } : {}) });
}
