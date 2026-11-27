/** A persistent seed (docs-draft/OBJECT_FILES_POC.md §15.5, §15.7 ticket 6): every distinct IR definition of a
 * program's objects written once as an immutable, content-addressed blob, and a manifest naming, per module object,
 * the digests its IR consists of. The manifest is published last, by rename, after every blob it names is on disk, so
 * a partial write is never a seed. Reading verifies every blob's digest; a missing or corrupt one is a miss
 * (SeedStoreMiss): the caller reseeds, never links a partial seed.
 *
 *   <store>/blobs/<2 hex>/<sha256>.json   one definition (encodeIrValue)
 *   <store>/manifests/<revision>.jsonl    a seed: its objects without IR bodies, with digests (JSON Lines)
 *   <store>/latest.json                   { revision } of the newest complete seed
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { IrClassDef, IrFunction, IrGlobal, IrModule, IrRecordShape, IrUnionDef } from "../ir/ir.js";
import { decodeIrValue, encodeIrValue } from "../ir/serialize.js";
import { WASMGC_OBJECT_SCHEMA, type WasmGcObject } from "./object.js";

export const SEED_SCHEMA = "scriptc-wasmgc-seed/1";

type Collections = { functions: IrFunction[]; classes: IrClassDef[]; globals: IrGlobal[]; records: IrRecordShape[]; unions: IrUnionDef[] };
const COLLECTIONS = ["functions", "classes", "globals", "records", "unions"] as const;

/** An object as the manifest holds it: everything but its IR's definitions, which are digests. */
interface StoredObject extends Omit<WasmGcObject, "ir" | "reads" | "sees" | "assumptions"> {
  ir: Omit<IrModule, keyof Collections>;
  definitions: Record<(typeof COLLECTIONS)[number], string[]>;
  /** Its read set, as indices into the manifest's file lines. */
  reads: number[];
  /** Values every object of a seed shares (one lowering's hierarchy, dispatch state, module list), by digest. */
  shared: { sees: string; hierarchy: string; dispatch: string };
  assumptions: Pick<WasmGcObject["assumptions"], "demands" | "arms">;
}

/** A manifest is JSON Lines, never one string (a whole client's would exceed V8's longest): a header line, then file,
 * shared-value and object lines, each object line after every line it refers to. */
type ManifestLine =
  | { kind: "header"; schema: typeof SEED_SCHEMA; objectSchema: typeof WASMGC_OBJECT_SCHEMA; revision: string }
  | { kind: "file"; path: string; digest: string }
  | { kind: "shared"; digest: string; value: unknown }
  | { kind: "object"; object: StoredObject };

export class SeedStoreMiss extends Error {}

export interface WriteSeedReport {
  manifest: string;
  /** Distinct definitions, and how many of them this write added (the rest were in the store already). */
  uniqueBlobs: number;
  writtenBlobs: number;
  /** Bytes of the distinct definitions, and of every object's references to them (what per-object copies would cost). */
  uniqueBytes: number;
  referencedBytes: number;
  ms: number;
}

const blobPath = (store: string, digest: string): string => join(store, "blobs", digest.slice(0, 2), `${digest}.json`);

async function writeAtomically(path: string, text: string): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, text);
  await rename(temp, path);
}

/** Writes a seed: its objects' definitions as blobs (each distinct one once), then its manifest, then latest.json. */
/** `revision` names the generation: the program revision of a fresh seed (the default), or the current snapshot's for
 * a validated mix of reused and recompiled objects (link/build.ts). */
export async function writeSeed(store: string, objects: readonly WasmGcObject[], revision = objects[0]?.stamp?.program): Promise<WriteSeedReport> {
  const start = performance.now();
  if (revision === undefined) throw new Error("writeSeed: the objects carry no program revision");
  // Objects partitioned from one lowering share definitions: encode each once (by identity), and each digest once.
  const digests = new WeakMap<object, { digest: string; bytes: number }>();
  const blobs = new Map<string, string>();
  let referencedBytes = 0;
  const digestOf = (definition: object): string => {
    let known = digests.get(definition);
    if (!known) {
      const text = encodeIrValue(definition);
      const digest = createHash("sha256").update(text).digest("hex");
      if (!blobs.has(digest)) blobs.set(digest, text);
      known = { digest, bytes: Buffer.byteLength(text) };
      digests.set(definition, known);
    }
    referencedBytes += known.bytes;
    return known.digest;
  };
  const lines: ManifestLine[] = [{ kind: "header", schema: SEED_SCHEMA, objectSchema: WASMGC_OBJECT_SCHEMA, revision }];
  const fileIndex = new Map<string, number>();
  let fileCount = 0;
  const fileOf = (path: string, digest: string): number => {
    const key = `${path}\0${digest}`;
    let index = fileIndex.get(key);
    if (index === undefined) { index = fileCount++; fileIndex.set(key, index); lines.push({ kind: "file", path, digest }); }
    return index;
  };
  const sharedDigests = new WeakMap<object, string>(), sharedWritten = new Set<string>();
  const sharedOf = (value: object): string => {
    let digest = sharedDigests.get(value);
    if (digest === undefined) {
      const text = JSON.stringify(value);
      digest = createHash("sha256").update(text).digest("hex");
      sharedDigests.set(value, digest);
      if (!sharedWritten.has(digest)) { sharedWritten.add(digest); lines.push({ kind: "shared", digest, value }); }
    }
    return digest;
  };
  for (const object of objects) {
    const { functions, classes, globals, records, unions, ...meta } = object.ir;
    const definitions = {
      functions: functions.map(digestOf), classes: (classes ?? []).map(digestOf), globals: (globals ?? []).map(digestOf),
      records: (records ?? []).map(digestOf), unions: (unions ?? []).map(digestOf),
    };
    const reads = Object.entries(object.reads).map(([path, digest]) => fileOf(path, digest));
    const { sees, assumptions, reads: _reads, ir: _ir, ...rest } = object;
    const shared = { sees: sharedOf(sees), hierarchy: sharedOf(assumptions.hierarchy), dispatch: sharedOf(assumptions.dispatch) };
    lines.push({ kind: "object", object: { ...rest, ir: meta, definitions, reads, shared, assumptions: { demands: assumptions.demands, arms: assumptions.arms } } });
  }
  let written = 0, uniqueBytes = 0;
  for (const [digest, text] of blobs) {
    uniqueBytes += Buffer.byteLength(text);
    const path = blobPath(store, digest);
    // A blob already there counts only when it still has its digest: a damaged one is replaced.
    try { if (createHash("sha256").update(await readFile(path, "utf8")).digest("hex") === digest) continue; } catch { /* absent: write it */ }
    await mkdir(join(store, "blobs", digest.slice(0, 2)), { recursive: true });
    await writeAtomically(path, text);
    written++;
  }
  await mkdir(join(store, "manifests"), { recursive: true });
  const manifestPath = join(store, "manifests", `${revision}.jsonl`);
  const temp = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temp, "w");
  try { for (const line of lines) await handle.write(JSON.stringify(line) + "\n"); }
  finally { await handle.close(); }
  await rename(temp, manifestPath);
  await writeAtomically(join(store, "latest.json"), JSON.stringify({ revision }));
  return { manifest: manifestPath, uniqueBlobs: blobs.size, writtenBlobs: written, uniqueBytes, referencedBytes, ms: Math.round(performance.now() - start) };
}

/** The newest complete seed's revision, or null. */
export async function latestSeedRevision(store: string): Promise<string | null> {
  try { return (JSON.parse(await readFile(join(store, "latest.json"), "utf8")) as { revision?: string }).revision ?? null; }
  catch { return null; }
}

/** Reads a seed back (the latest when no revision is given). Each blob is read, verified and decoded once, and shared
 * by every object that names it. Throws SeedStoreMiss when the manifest or any blob is missing or corrupt. */
export async function readSeed(store: string, revision?: string): Promise<WasmGcObject[]> {
  const wanted = revision ?? (await latestSeedRevision(store));
  if (wanted === null) throw new SeedStoreMiss(`${store}: no seed`);
  const lines: ManifestLine[] = [];
  try {
    const input = createInterface({ input: createReadStream(join(store, "manifests", `${wanted}.jsonl`), "utf8"), crlfDelay: Infinity });
    for await (const line of input) if (line.length > 0) lines.push(JSON.parse(line) as ManifestLine);
  } catch { throw new SeedStoreMiss(`${store}: no seed for revision ${wanted.slice(0, 12)}`); }
  const header = lines[0];
  if (header?.kind !== "header" || header.schema !== SEED_SCHEMA || header.objectSchema !== WASMGC_OBJECT_SCHEMA) throw new SeedStoreMiss(`${store}: seed ${wanted.slice(0, 12)} is another schema`);
  const decoded = new Map<string, unknown>();
  const load = async (digest: string): Promise<unknown> => {
    const cached = decoded.get(digest);
    if (cached !== undefined) return cached;
    let text: string;
    try { text = await readFile(blobPath(store, digest), "utf8"); }
    catch { throw new SeedStoreMiss(`${store}: blob ${digest.slice(0, 12)} is missing`); }
    if (createHash("sha256").update(text).digest("hex") !== digest) throw new SeedStoreMiss(`${store}: blob ${digest.slice(0, 12)} is corrupt`);
    const value = decodeIrValue<unknown>(text);
    decoded.set(digest, value);
    return value;
  };
  const files: [string, string][] = [], shared = new Map<string, unknown>();
  const objects: WasmGcObject[] = [];
  for (const line of lines) {
    if (line.kind === "file") files.push([line.path, line.digest]);
    else if (line.kind === "shared") shared.set(line.digest, line.value);
    else if (line.kind === "object") {
      const { definitions, ir, reads, shared: refs, assumptions, ...object } = line.object;
      const collections: Record<string, unknown[]> = {};
      for (const kind of COLLECTIONS) collections[kind] = await Promise.all(definitions[kind].map(load));
      const sharedValue = <T>(digest: string): T => {
        if (!shared.has(digest)) throw new SeedStoreMiss(`${store}: seed ${wanted.slice(0, 12)} refers to a value it does not hold`);
        return shared.get(digest) as T;
      };
      objects.push({
        ...object, ir: { ...ir, ...collections } as IrModule,
        reads: Object.fromEntries(reads.map((i) => files[i]!)),
        sees: sharedValue<string[]>(refs.sees),
        assumptions: { ...assumptions, hierarchy: sharedValue(refs.hierarchy), dispatch: sharedValue(refs.dispatch) },
      });
    }
  }
  return objects;
}

/** Removes every seed but the newest `keep`, then every blob no remaining seed names. */
export async function pruneSeeds(store: string, keep = 1): Promise<{ removedSeeds: number; removedBlobs: number }> {
  const dir = join(store, "manifests");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".jsonl"));
  const dated = await Promise.all(names.map(async (n) => ({ n, at: (await stat(join(dir, n))).mtimeMs })));
  dated.sort((a, b) => b.at - a.at);
  const kept = dated.slice(0, keep), removed = dated.slice(keep);
  for (const r of removed) await rm(join(dir, r.n), { force: true });
  const live = new Set<string>();
  for (const k of kept) {
    const input = createInterface({ input: createReadStream(join(dir, k.n), "utf8"), crlfDelay: Infinity });
    for await (const text of input) {
      if (text.length === 0) continue;
      const line = JSON.parse(text) as ManifestLine;
      if (line.kind === "object") for (const kind of COLLECTIONS) for (const d of line.object.definitions[kind]) live.add(d);
    }
  }
  let removedBlobs = 0;
  for (const prefix of await readdir(join(store, "blobs")).catch(() => [] as string[])) {
    for (const file of await readdir(join(store, "blobs", prefix))) {
      if (!live.has(file.replace(/\.json$/, ""))) { await rm(join(store, "blobs", prefix, file), { force: true }); removedBlobs++; }
    }
  }
  return { removedSeeds: removed.length, removedBlobs };
}
