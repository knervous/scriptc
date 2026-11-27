/* Separate compilation (docs-draft/OBJECT_FILES_POC.md): objects compiled one module at a time link into a module that
 * prints what the whole-program build prints, and the linker refuses what it cannot prove. The binaries run under the
 * browser lane's runner (tests/wasmgc-browser/run-wasm.mjs, which loads the built dist's host). */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "vitest";
import { compile } from "../index.js";
import { compileObject, compileProgramObjects, objectFilePath, PROGRAM_DISPATCH_FILE, PROGRAM_DISPATCH_MODULE, readObject, type WasmGcObject } from "./object.js";
import { LinkError, linkObjects, linkWasmGc } from "./link.js";
import { buildObjects, writeLinkedBuild } from "./build.js";
import { pruneSeeds, readSeed, SeedStoreMiss, writeSeed } from "./store.js";

const checkout = fileURLToPath(new URL("../../../../", import.meta.url));
const slices = join(checkout, "tests/wasmgc-objects");
const scratch = mkdtempSync(join(tmpdir(), "wasmgc-objects-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const run = (wasm: string): string => execFileSync(process.execPath, [
  "--import", join(checkout, "tests/wasmgc-browser/prelude.mjs"), join(checkout, "tests/wasmgc-browser/run-wasm.mjs"), wasm,
], { encoding: "utf8" });

/** A slice copied to its own directory (an edit then stays local to the test). */
function copySlice(name: string): string {
  const dir = mkdtempSync(join(scratch, `${name}-`));
  cpSync(join(slices, name), dir, { recursive: true });
  return dir;
}

/** Each module's object, every one lowered from the program rooted at `entry` (the client's configuration), or from the
 * module's own import graph when `entry` is null. */
async function objectsOf(dir: string, modules: readonly string[], entry: string | null): Promise<WasmGcObject[]> {
  const out: WasmGcObject[] = [];
  for (const m of modules) {
    const path = join(dir, m.replace(/\.ts$/, ".wobj"));
    await compileObject(join(dir, m), { root: dir, outPath: path, ...(entry !== null ? { programRoot: join(dir, entry) } : {}) });
    out.push(await readObject(path));
  }
  return out;
}

/** An object as a cache would compare it across revisions: the whole-program digest names the revision, not the content. */
const content = (o: WasmGcObject): string => JSON.stringify({ ...o, stamp: o.stamp && { ...o.stamp, program: null }, reads: Object.keys(o.reads) });

async function wholeProgram(dir: string, entry: string, dev: boolean): Promise<string> {
  const wasm = join(dir, "whole.wasm");
  const r = await compile(join(dir, entry), { outDir: dir, outPath: wasm, outputKind: "wasmgc", browser: true, dynModel: "native", ...(dev ? { optimization: "dev" as const } : {}) });
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics).slice(0, 600));
  return run(wasm);
}

function linkProblems(objects: readonly WasmGcObject[], entry?: string, mixed = false): readonly string[] {
  try {
    linkObjects(objects, { ...(entry !== undefined ? { entry } : {}), ...(mixed ? { acceptMixedRevisions: true as const } : {}) });
  } catch (e) {
    if (e instanceof LinkError) return e.problems;
    throw e;
  }
  return [];
}

test("three separately compiled modules link into the whole program's behavior (-O2)", async () => {
  const dir = copySlice("three");
  const objects = await objectsOf(dir, ["geom.ts", "square.ts", "app.ts"], "app.ts");
  // A's classes and C's subclass cross to B by name and layout; B's object references them (it constructs a Square), it
  // does not define them.
  const app = objects[2]!;
  expect(Object.keys(app.references.classes).sort()).toEqual(["%m3592186684.Rect", "%m3592186684.Shape", "%m618134773.Square"]);
  expect(Object.keys(app.defines.classes)).toEqual([]);
  const linked = linkWasmGc(objects, { entry: "app.ts" });
  writeFileSync(join(dir, "linked.wasm"), linked.binary);
  const expected = "rect area 24\nsquare area 25\nblank area 0\ntotal 49\nsizes 6x4 5x5\n";
  expect(run(join(dir, "linked.wasm"))).toBe(expected);
  expect(await wholeProgram(dir, "app.ts", false)).toBe(expected);
}, 240000);

test("COMDAT helpers and closures across objects (dev)", async () => {
  const dir = copySlice("closures");
  const objects = await objectsOf(dir, ["lib.ts", "main.ts"], "main.ts");
  // Both objects reach the keyed array-map helper; each carries it and the linker keeps one.
  expect(objects.every((o) => o.comdat.some((n) => n.startsWith("%arr.map.")))).toBe(true);
  writeFileSync(join(dir, "linked.wasm"), linkWasmGc(objects, { entry: "main.ts", optimizeLevel: 0 }).binary);
  expect(run(join(dir, "linked.wasm"))).toBe(await wholeProgram(dir, "main.ts", true));
  expect(run(join(dir, "linked.wasm"))).toBe("lib 7 3,5,7\n");
}, 240000);

test("an object compiled without a subclass is refused, not miscompiled", async () => {
  const dir = copySlice("open-class");
  // Each module's own import graph: base.ts never sees Sub, so its this.f() in g() calls Base.f directly.
  const closures = await objectsOf(dir, ["base.ts", "sub.ts", "main.ts"], null);
  // Each object's program is its own import graph, so they share no revision; past that, the hierarchy is wrong too.
  expect(linkProblems(closures).some((p) => /program revisions/.test(p))).toBe(true);
  const problems = linkProblems(closures, undefined, true);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(/^base\.ts was compiled without %m\d+\.Sub \(sub\.ts\), a subclass of %m\d+\.Base: /);
  // The whole program sees the override and dispatches through it, and so do objects lowered from it.
  expect(await wholeProgram(dir, "main.ts", true)).toBe("12\n");
  const rooted = await objectsOf(dir, ["base.ts", "sub.ts", "main.ts"], "main.ts");
  writeFileSync(join(dir, "linked.wasm"), linkWasmGc(rooted, { entry: "main.ts", optimizeLevel: 0 }).binary);
  expect(run(join(dir, "linked.wasm"))).toBe("12\n");
}, 240000);

test("a call through a base type reaches an override in a module the caller's body never lowers (-O2)", async () => {
  // Header mode lowers sub.ts's bodies only in sub.ts's object: base.ts's lowering never reaches Sub.f, and still
  // dispatches through it (the closed-world devirtualization runs on whole programs only).
  const dir = mkdtempSync(join(scratch, "override-"));
  writeFileSync(join(dir, "base.ts"), "export class Base { f(): number { return 1; } }\nexport function via(x: Base): number { return x.f(); }\n");
  writeFileSync(join(dir, "sub.ts"), 'import { Base } from "./base";\nexport class Sub extends Base { f(): number { return 2; } }\n');
  writeFileSync(join(dir, "main.ts"), 'import { via } from "./base";\nimport { Sub } from "./sub";\nconsole.log(via(new Sub()));\n');
  const objects = await objectsOf(dir, ["base.ts", "sub.ts", "main.ts"], "main.ts");
  writeFileSync(join(dir, "linked.wasm"), linkWasmGc(objects, { entry: "main.ts" }).binary);
  expect(run(join(dir, "linked.wasm"))).toBe("2\n");
  // An override added since the other objects were compiled: they decided against the old Sub, so they are stale.
  writeFileSync(join(dir, "sub.ts"), 'import { Base } from "./base";\nexport class Sub extends Base { f(): number { return 2; } g(): number { return 3; } }\n');
  const [newSub] = await objectsOf(dir, ["sub.ts"], "main.ts");
  expect(linkProblems([objects[0]!, newSub!, objects[2]!], "main.ts").some((p) => /program revisions/.test(p))).toBe(true);
  const problems = linkProblems([objects[0]!, newSub!, objects[2]!], "main.ts", true);
  expect(problems).toContain("base.ts was compiled against another version of class " + Object.keys(newSub!.defines.classes)[0] + " (sub.ts defines it differently now): recompile base.ts");
}, 240000);

test("a source edit in one process compiles the new text, and the stamp hashes that text", async () => {
  const dir = mkdtempSync(join(scratch, "edit-"));
  const main = join(dir, "main.ts");
  writeFileSync(main, "console.log(1);\n");
  // One shared checker host and batch program serve both compiles (the warm session's configuration).
  const was = process.env["SCRIPTC_SHARE_TS7_HOST"];
  process.env["SCRIPTC_SHARE_TS7_HOST"] = "1";
  const objectOf = async (): Promise<WasmGcObject> => {
    const path = join(dir, "main.wobj");
    await compileObject(main, { root: dir, outPath: path, programRoot: main, compileOptions: { batchRoots: [main] } });
    return readObject(path);
  };
  try {
    const before = await objectOf();
    writeFileSync(main, "console.log(2);\n");
    const after = await objectOf();
    writeFileSync(join(dir, "linked.wasm"), linkWasmGc([after], { entry: "main.ts", optimizeLevel: 0, revision: after.stamp!.program }).binary);
    expect(run(join(dir, "linked.wasm"))).toBe("2\n");
    expect(after.stamp!.source).toBe(createHash("sha256").update("console.log(2);\n").digest("hex"));
    expect(after.stamp!.program).not.toBe(before.stamp!.program);
  } finally {
    if (was === undefined) delete process.env["SCRIPTC_SHARE_TS7_HOST"]; else process.env["SCRIPTC_SHARE_TS7_HOST"] = was;
  }
}, 240000);

test("an object compiled against an old class layout is refused as stale", async () => {
  const dir = copySlice("three");
  const before = await objectsOf(dir, ["geom.ts", "square.ts", "app.ts"], "app.ts");
  const geom = join(dir, "geom.ts");
  writeFileSync(geom, readFileSync(geom, "utf8").replace("constructor(public name: string) {}", "tag = 0;\n  constructor(public name: string) {}"));
  const [newGeom] = await objectsOf(dir, ["geom.ts"], "app.ts");
  const problems = linkProblems([newGeom!, before[1]!, before[2]!], "app.ts", true);
  expect(problems.some((p) => /^square\.ts: class %m\d+\.Shape was compiled against .* \(a stale object: recompile square\.ts\)$/.test(p))).toBe(true);
  expect(problems.some((p) => p.startsWith("app.ts: class %m3592186684.Shape"))).toBe(true);
}, 240000);

test("a body-only edit leaves the other objects identical, and the mixed revision is refused unless asked for", async () => {
  const dir = copySlice("three");
  const before = await objectsOf(dir, ["geom.ts", "square.ts", "app.ts"], "app.ts");
  const geom = join(dir, "geom.ts");
  writeFileSync(geom, readFileSync(geom, "utf8").replace("return this.w * this.h;", "return this.h * this.w + 0;"));
  const after = await objectsOf(dir, ["geom.ts", "square.ts", "app.ts"], "app.ts");
  expect(JSON.stringify(after[0]!.ir)).not.toBe(JSON.stringify(before[0]!.ir));
  expect(content(after[1]!)).toBe(content(before[1]!));
  expect(content(after[2]!)).toBe(content(before[2]!));
  // The objects come from two program revisions: nothing proves the old ones read no compile-time fact of geom.ts.
  expect(linkProblems([after[0]!, before[1]!, before[2]!], "app.ts").some((p) => /^objects from 2 program revisions: /.test(p))).toBe(true);
  expect(linkProblems([after[0]!, after[1]!, after[2]!], "app.ts")).toEqual([]);
  expect(() => linkObjects([after[0]!, before[1]!, before[2]!], { entry: "app.ts", acceptMixedRevisions: true })).not.toThrow();
}, 240000);

test("a reference to a module with no object in the link is an undefined symbol", async () => {
  const dir = copySlice("two");
  const [, app] = await objectsOf(dir, ["geom.ts", "app.ts"], "app.ts");
  const problems = linkProblems([app!], "app.ts");
  expect(problems).toContain("app.ts: undefined function %m3592186684.scale (its module's object is not in the link)");
}, 240000);

test("one lowering of the program seeds every module's object, and they link into its behavior (-O2)", async () => {
  const dir = copySlice("three");
  const seeded = await compileProgramObjects(join(dir, "app.ts"), { root: dir, outDir: join(dir, "seeded") });
  // One object per module, plus the program's dispatchers' when it has any.
  expect(seeded.map((s) => s.object.module.path).filter((p) => p !== PROGRAM_DISPATCH_MODULE).sort()).toEqual(["app.ts", "geom.ts", "square.ts"]);
  expect(seeded.every((s) => s.object.lowering === "closure")).toBe(true);
  // Only the entry's object carries %main.
  expect(seeded.filter((s) => s.object.ir.functions.some((f) => f.name === "%main")).map((s) => s.object.module.path)).toEqual(["app.ts"]);
  writeFileSync(join(dir, "linked.wasm"), linkWasmGc(seeded.map((s) => s.object), { entry: "app.ts" }).binary);
  expect(run(join(dir, "linked.wasm"))).toBe("rect area 24\nsquare area 25\nblank area 0\ntotal 49\nsizes 6x4 5x5\n");
  // A module recompiled alone (header mode) links with the seeded others.
  const [square] = await objectsOf(dir, ["square.ts"], "app.ts");
  writeFileSync(join(dir, "mixed.wasm"), linkWasmGc([...seeded.filter((s) => !s.file.endsWith("square.ts")).map((s) => s.object), square!], { entry: "app.ts" }).binary);
  expect(run(join(dir, "mixed.wasm"))).toBe("rect area 24\nsquare area 25\nblank area 0\ntotal 49\nsizes 6x4 5x5\n");
}, 240000);

test("a recompiled module whose code reaches past the seeded dispatchers is refused, then reseeding links", async () => {
  // lib.ts's computed read dispatches over the classes the program boxes. main.ts, edited, boxes a new class B; its
  // header-mode lowering carries no copy of that dispatcher (lib.ts's body is a header there), so only the dispatch
  // state it records can show that lib.ts's seeded copy misses B.
  const dir = mkdtempSync(join(scratch, "dispatch-"));
  writeFileSync(join(dir, "lib.ts"), "export class A { x = 1; }\nexport function read(v: unknown, k: string): unknown { return (v as Record<string, unknown>)[k]; }\n");
  writeFileSync(join(dir, "main.ts"), 'import { A, read } from "./lib";\nconsole.log(read(new A(), "x"));\n');
  const seeded = await compileProgramObjects(join(dir, "main.ts"), { root: dir, outDir: join(dir, "seeded") });
  writeFileSync(join(dir, "main.ts"), 'import { A, read } from "./lib";\nclass B { y = 2; }\nconsole.log(read(new A(), "x"), read(new B(), "y"));\n');
  const [main] = await objectsOf(dir, ["main.ts"], "main.ts");
  const lib = seeded.find((s) => s.file.endsWith("lib.ts"))!.object;
  expect(linkProblems([lib, main!], "main.ts").some((p) => /program revisions/.test(p))).toBe(true);
  const problems = linkProblems([lib, main!], "main.ts", true);
  expect(problems.some((p) => /^main\.ts: its code reaches dispatch entries the program's complete lowering \(lib\.ts\) lacks \(boxed: %m\d+\.B\)/.test(p))).toBe(true);
  const reseeded = await compileProgramObjects(join(dir, "main.ts"), { root: dir, outDir: join(dir, "reseeded") });
  writeFileSync(join(dir, "linked.wasm"), linkWasmGc(reseeded.map((s) => s.object), { entry: "main.ts", optimizeLevel: 0 }).binary);
  expect(run(join(dir, "linked.wasm"))).toBe("1 2\n");
}, 240000);


test("a class constructed through a dynamic value runs from seeded objects (the packed construction helper is kept)", async () => {
  const dir = mkdtempSync(join(scratch, "class-value-"));
  const fixtures = join(checkout, "tests/wasmgc-browser/fixtures");
  writeFileSync(join(dir, "main.ts"), readFileSync(join(fixtures, "libs-class-value.ts"), "utf8"));
  writeFileSync(join(dir, "libs-class-value-helper.js"), readFileSync(join(fixtures, "libs-class-value-helper.js"), "utf8"));
  const seeded = await compileProgramObjects(join(dir, "main.ts"), { root: dir, outDir: join(dir, "seeded") });
  expect(seeded.some((s) => s.object.comdat.includes("%class.construct:packed"))).toBe(true);
  writeFileSync(join(dir, "linked.wasm"), linkWasmGc(seeded.map((s) => s.object), { entry: "main.ts", optimizeLevel: 0 }).binary);
  expect(run(join(dir, "linked.wasm"))).toBe("Counter:2:true\n");
}, 240000);

test("an edit to an inlined constant cannot link with objects of the old revision; reseeding gives the new value", async () => {
  // Astra §15.3: lib.ts changes Choice.Value 1 -> 2 and value() 3 -> 4. main.ts's object inlined the old constant.
  const dir = mkdtempSync(join(scratch, "revision-"));
  writeFileSync(join(dir, "lib.ts"), "export const enum Choice { Value = 1 }\nexport function value(): number { return 3; }\n");
  writeFileSync(join(dir, "main.ts"), 'import { Choice, value } from "./lib";\nconsole.log(Choice.Value, value());\n');
  const seeded = await compileProgramObjects(join(dir, "main.ts"), { root: dir, outDir: join(dir, "seeded") });
  writeFileSync(join(dir, "lib.ts"), "export const enum Choice { Value = 2 }\nexport function value(): number { return 4; }\n");
  const [lib] = await objectsOf(dir, ["lib.ts"], "main.ts");
  const mixed = seeded.map((s) => (s.file.endsWith("lib.ts") ? lib! : s.object));
  expect(linkProblems(mixed, "main.ts").some((p) => /program revisions/.test(p))).toBe(true);
  // A build request names its revision: objects of any other are refused even when they agree with each other.
  expect(linkProblems(seeded.map((s) => s.object), "main.ts").length).toBe(0);
  expect(() => linkObjects(seeded.map((s) => s.object), { entry: "main.ts", revision: lib!.stamp!.program })).toThrow(LinkError);
  const reseeded = await compileProgramObjects(join(dir, "main.ts"), { root: dir, outDir: join(dir, "reseeded") });
  writeFileSync(join(dir, "linked.wasm"), linkWasmGc(reseeded.map((s) => s.object), { entry: "main.ts", revision: lib!.stamp!.program }).binary);
  expect(run(join(dir, "linked.wasm"))).toBe("2 4\n");
}, 240000);

const DEAD_GENERIC_LIB = `function remap<T extends Float32Array | Uint16Array>(stream: T): T {
  const output = stream.slice(0, 4);
  for (let i = 0; i < 4; i++) output[i] = stream[i]!;
  return output as T;
}
export function unused(): Uint16Array { return remap(new Uint16Array(4)); }
export function used(): number { return 1; }
`;

test("seeding and a seeded recompile lower what the program reaches: dead code the compiler refuses stays unlowered", async () => {
  // Astra §15.4: whole program prints ok; unused() instantiates remap with a type the compiler refuses.
  const dir = mkdtempSync(join(scratch, "dead-generic-"));
  writeFileSync(join(dir, "lib.ts"), DEAD_GENERIC_LIB);
  writeFileSync(join(dir, "main.ts"), 'import { used } from "./lib";\nconsole.log("ok", used());\n');
  const seeded = await compileProgramObjects(join(dir, "main.ts"), { root: dir, outDir: join(dir, "seeded") });
  writeFileSync(join(dir, "linked.wasm"), linkWasmGc(seeded.map((s) => s.object), { entry: "main.ts", optimizeLevel: 0 }).binary);
  expect(run(join(dir, "linked.wasm"))).toBe("ok 1\n");
  // lib.ts recompiled alone against its seed roots what the seed defined: unused() stays out, and the set links.
  const libSeed = seeded.find((s) => s.file.endsWith("lib.ts"))!;
  expect(Object.keys(libSeed.object.defines.functions).some((n) => n.endsWith(".unused"))).toBe(false);
  const path = join(dir, "lib-recompiled.wobj");
  await compileObject(join(dir, "lib.ts"), { root: dir, outPath: path, programRoot: join(dir, "main.ts"), seed: libSeed.object });
  const lib = await readObject(path);
  writeFileSync(join(dir, "mixed.wasm"), linkWasmGc(seeded.map((s) => (s === libSeed ? lib : s.object)), { entry: "main.ts", optimizeLevel: 0 }).binary);
  expect(run(join(dir, "mixed.wasm"))).toBe("ok 1\n");
}, 240000);

test("an edit that makes the dead code live reseeds once, and then refuses as the whole program does", async () => {
  const dir = mkdtempSync(join(scratch, "dead-live-"));
  writeFileSync(join(dir, "lib.ts"), DEAD_GENERIC_LIB);
  const main = join(dir, "main.ts");
  writeFileSync(main, 'import { used } from "./lib";\nconsole.log("ok", used());\n');
  const first = await buildObjects(main, { root: dir, outDir: join(dir, "a") });
  expect(first.reseeded).toEqual(["no seed"]);
  // A body edit to main.ts: only its object read main.ts, so it alone is recompiled and the seed's lib.ts is reused.
  writeFileSync(main, 'import { used } from "./lib";\nconsole.log("ok", used() + 1);\n');
  const second = await buildObjects(main, { root: dir, outDir: join(dir, "b"), seed: first.seed });
  expect(second.reseeded).toBeNull();
  expect(second.recompiled).toBe(1);
  writeFileSync(join(dir, "second.wasm"), second.binary);
  expect(run(join(dir, "second.wasm"))).toBe("ok 2\n");
  // Now main.ts calls unused(): the whole program refuses, and so does the build, once, with the compiler's reason.
  writeFileSync(main, 'import { unused } from "./lib";\nconsole.log("ok", unused().length);\n');
  const whole = await compile(main, { outDir: dir, outPath: join(dir, "whole.wasm"), outputKind: "wasmgc", browser: true, dynModel: "native", optimization: "dev" });
  expect(whole.ok).toBe(false);
  await expect(buildObjects(main, { root: dir, outDir: join(dir, "c"), seed: second.seed, edited: [main] }))
    .rejects.toThrow(/element access on non-array values/);
}, 240000);

test("object file paths are injective, and no source module maps onto the program artifact", () => {
  const paths = ["lib.ts", "lib.mts", "../lib.ts", "%up/lib.ts", "%program.ts", "%program", "a/../b.ts"].map(objectFilePath);
  expect(new Set(paths).size).toBe(paths.length);
  expect(paths).not.toContain(PROGRAM_DISPATCH_FILE);
  expect(objectFilePath("../lib.ts")).toBe("%up/lib.ts.wobj");
});

test("a strict release link refuses what the whole-program strict build refuses (one shared emission policy)", async () => {
  // Astra §15.6: libs-extends-builtins' whole strict build is refused SC3002; its seeded objects used to link and run.
  const dir = mkdtempSync(join(scratch, "strict-"));
  const fixtures = join(checkout, "tests/wasmgc-browser/fixtures");
  writeFileSync(join(dir, "main.ts"), readFileSync(join(fixtures, "libs-extends-builtins.ts"), "utf8"));
  writeFileSync(join(dir, "libs-extends-builtins-helper.js"), readFileSync(join(fixtures, "libs-extends-builtins-helper.js"), "utf8"));
  const main = join(dir, "main.ts");
  const whole = await compile(main, { outDir: dir, outPath: join(dir, "whole.wasm"), outputKind: "wasmgc", browser: true, dynModel: "native", release: true });
  expect(whole.ok).toBe(false);
  const compileOptions = { release: true };
  const seeded = await compileProgramObjects(main, { root: dir, outDir: join(dir, "seeded"), compileOptions });
  const linked = await writeLinkedBuild(seeded.map((s) => s.object), { entry: main, root: dir, compileOptions, outPath: join(dir, "linked.wasm") });
  expect(linked.ok).toBe(false);
  const codes = (r: { ok: boolean; diagnostics?: readonly { code: string }[] }) => (r.ok ? [] : (r.diagnostics ?? []).map((d) => d.code)).sort();
  expect(codes(linked)).toEqual(codes(whole));
  // The build's options must be the objects' own.
  await expect(writeLinkedBuild(seeded.map((s) => s.object), { entry: main, root: dir, compileOptions: {}, outPath: join(dir, "other.wasm") })).rejects.toThrow(/other options/);
}, 240000);

test("a linked build writes the artifacts a whole-program build does: host imports, source map, release manifest", async () => {
  const dir = copySlice("three");
  const main = join(dir, "app.ts");
  for (const [label, compileOptions] of [["dev", { optimization: "dev", sourceMap: true, sourceMapUrl: "http://localhost/x.map" }], ["release", { release: true }]] as const) {
    const whole = await compile(main, { outDir: dir, outPath: join(dir, `whole-${label}.wasm`), outputKind: "wasmgc", browser: true, dynModel: "native", ...compileOptions });
    expect(whole.ok).toBe(true);
    const seeded = await compileProgramObjects(main, { root: dir, outDir: join(dir, `seeded-${label}`), compileOptions });
    const linked = await writeLinkedBuild(seeded.map((s) => s.object), { entry: main, root: dir, compileOptions, outPath: join(dir, `linked-${label}.wasm`) });
    expect(linked.ok ? [] : linked.diagnostics.map((d) => d.message)).toEqual([]);
    expect(readFileSync(join(dir, `linked-${label}.wasm.host.json`), "utf8")).toBe(readFileSync(join(dir, `whole-${label}.wasm.host.json`), "utf8"));
    for (const suffix of label === "dev" ? [".map"] : [".manifest.json"]) {
      expect(() => readFileSync(join(dir, `linked-${label}.wasm${suffix}`))).not.toThrow();
    }
    expect(run(join(dir, `linked-${label}.wasm`))).toBe(run(join(dir, `whole-${label}.wasm`)));
  }
}, 480000);

test("a shared host notices a file that changes what an import resolves to, and recompiles the new resolution", async () => {
  // Astra §15.6: ./dep resolves to dep/index.ts; adding dep.ts beside it takes precedence. No loaded file changed.
  const dir = mkdtempSync(join(scratch, "resolution-"));
  const main = join(dir, "main.ts");
  mkdirSync(join(dir, "dep"));
  writeFileSync(join(dir, "dep", "index.ts"), "export const value = 1;\n");
  writeFileSync(main, 'import { value } from "./dep";\nconsole.log(value);\n');
  const was = process.env["SCRIPTC_SHARE_TS7_HOST"];
  process.env["SCRIPTC_SHARE_TS7_HOST"] = "1";
  const objectOf = async (file: string): Promise<WasmGcObject> => {
    const path = join(dir, `${file.replace(/[/.]/g, "_")}.wobj`);
    await compileObject(join(dir, file), { root: dir, outPath: path, programRoot: main, compileOptions: { batchRoots: [main] } });
    return readObject(path);
  };
  try {
    const before = await objectOf("main.ts");
    writeFileSync(join(dir, "dep.ts"), "export const value = 2;\n");
    const t = performance.now();
    const after = await objectOf("main.ts");
    const firstEditMs = performance.now() - t;
    expect(after.stamp!.program).not.toBe(before.stamp!.program);
    const dep = await objectOf("dep.ts");
    writeFileSync(join(dir, "linked.wasm"), linkWasmGc([after, dep], { entry: "main.ts", optimizeLevel: 0 }).binary);
    expect(run(join(dir, "linked.wasm"))).toBe("2\n");
    expect(firstEditMs).toBeGreaterThan(0);
  } finally {
    if (was === undefined) delete process.env["SCRIPTC_SHARE_TS7_HOST"]; else process.env["SCRIPTC_SHARE_TS7_HOST"] = was;
  }
}, 240000);

test("a seed store writes each distinct definition once and reads back a seed that links alike; a corrupt blob is a miss", async () => {
  const dir = mkdtempSync(join(scratch, "store-"));
  // -0, NaN and Infinity must survive the blobs as they survive the module serializer.
  writeFileSync(join(dir, "lib.ts"), "export const odd = [-0, NaN, Infinity];\nexport function show(): string { return odd.map((v) => (Object.is(v, -0) ? \"-0\" : String(v))).join(\",\"); }\n");
  writeFileSync(join(dir, "main.ts"), 'import { show } from "./lib";\nconsole.log(show());\n');
  const main = join(dir, "main.ts"), store = join(dir, "store");
  const seeded = await compileProgramObjects(main, { root: dir, outDir: join(dir, "seeded") });
  const first = await writeSeed(store, seeded.map((s) => s.object));
  expect(first.writtenBlobs).toBe(first.uniqueBlobs);
  expect(first.referencedBytes).toBeGreaterThanOrEqual(first.uniqueBytes);
  expect((await writeSeed(store, seeded.map((s) => s.object))).writtenBlobs).toBe(0);
  const read = await readSeed(store);
  writeFileSync(join(dir, "linked.wasm"), linkWasmGc(read, { entry: "main.ts", optimizeLevel: 0 }).binary);
  expect(run(join(dir, "linked.wasm"))).toBe("-0,NaN,Infinity\n");
  // A changed blob is refused by its digest, and the build path reseeds instead of linking it.
  const blobs = join(store, "blobs");
  const prefix = readdirSync(blobs)[0]!, blob = join(blobs, prefix, readdirSync(join(blobs, prefix))[0]!);
  writeFileSync(blob, readFileSync(blob, "utf8") + " ");
  await expect(readSeed(store)).rejects.toThrow(SeedStoreMiss);
  const rebuilt = await buildObjects(main, { root: dir, outDir: join(dir, "b"), store });
  expect(rebuilt.reseeded).toEqual(["no seed"]);
  // The reseed wrote its seed back: the next build reads it from the store and links it.
  const again = await buildObjects(main, { root: dir, outDir: join(dir, "c"), store });
  expect(again.reseeded).toBeNull();
  writeFileSync(join(dir, "again.wasm"), again.binary);
  expect(run(join(dir, "again.wasm"))).toBe("-0,NaN,Infinity\n");
  expect((await pruneSeeds(store, 1)).removedSeeds).toBe(0);
}, 240000);

test("read sets: a no-op build recompiles nothing, an edit recompiles only the objects that read it, and output follows the edit", async () => {
  const dir = copySlice("three");
  const app = join(dir, "app.ts"), store = join(dir, "store");
  const expected = "rect area 24\nsquare area 25\nblank area 0\ntotal 49\nsizes 6x4 5x5\n";
  const runBinary = (binary: Uint8Array, name: string): string => { writeFileSync(join(dir, name), binary); return run(join(dir, name)); };
  const cold = await buildObjects(app, { root: dir, outDir: join(dir, "a"), store });
  expect(runBinary(cold.binary, "cold.wasm")).toBe(expected);
  const noop = await buildObjects(app, { root: dir, outDir: join(dir, "b"), store });
  expect([noop.reseeded, noop.recompiled]).toEqual([null, 0]);
  expect(runBinary(noop.binary, "noop.wasm")).toBe(expected);
  // square.ts is a leaf: app.ts reads it (imports it), geom.ts does not. Its body edit recompiles square.ts and app.ts.
  const square = join(dir, "square.ts");
  writeFileSync(square, readFileSync(square, "utf8").replace("export class Square", "// edited\nexport class Square"));
  const body = await buildObjects(app, { root: dir, outDir: join(dir, "c"), store });
  expect(body.reseeded).toBeNull();
  expect(body.recompiled).toBe(2);
  expect(runBinary(body.binary, "body.wasm")).toBe(expected);
}, 480000);

test("read sets: a constant edit recompiles its reader to the new value; a hierarchy edit is refused and reseeds", async () => {
  const dir = mkdtempSync(join(scratch, "readsets-"));
  const main = join(dir, "main.ts"), lib = join(dir, "lib.ts");
  writeFileSync(lib, "export const enum Choice { Value = 1 }\nexport class Base { f(): number { return 1; } }\nexport function via(x: Base): number { return x.f(); }\n");
  writeFileSync(join(dir, "sub.ts"), 'import { Base } from "./lib";\nexport class Sub extends Base {}\n');
  writeFileSync(main, 'import { Choice, via } from "./lib";\nimport { Sub } from "./sub";\nconsole.log(Choice.Value, via(new Sub()));\n');
  const runBinary = (binary: Uint8Array, name: string): string => { writeFileSync(join(dir, name), binary); return run(join(dir, name)); };
  const first = await buildObjects(main, { root: dir, outDir: join(dir, "a") });
  expect(runBinary(first.binary, "a.wasm")).toBe("1 1\n");
  writeFileSync(lib, readFileSync(lib, "utf8").replace("Value = 1", "Value = 2"));
  const constant = await buildObjects(main, { root: dir, outDir: join(dir, "b"), seed: first.seed });
  expect(constant.reseeded).toBeNull();
  expect(runBinary(constant.binary, "b.wasm")).toBe("2 1\n");
  // Sub gains an override: lib.ts's object (which does not read sub.ts) decided Base.f's dispatch without it.
  writeFileSync(join(dir, "sub.ts"), 'import { Base } from "./lib";\nexport class Sub extends Base { f(): number { return 7; } }\n');
  const hierarchy = await buildObjects(main, { root: dir, outDir: join(dir, "c"), seed: constant.seed });
  expect(hierarchy.reseeded?.some((r) => /another version of class/.test(r))).toBe(true);
  expect(runBinary(hierarchy.binary, "c.wasm")).toBe("2 7\n");
}, 480000);
