// experimentalJsSpecialize "profile": a V8 site profile turns matched sites
// into guarded arms ahead of the unchanged generic path. These tests build a
// synthetic profile for test/fixtures/profile-specialization/sites.js and check
// that (1) the profiled sites really get guards, (2) every receiver or callee
// the profile did not predict (other shapes, dictionaries, prototypes,
// accessors, records vs objects, other functions, bound functions, other
// closures; for adds, inherited setters, before and after any accessor
// exists, and prototypes that gain one or change) still behaves exactly as
// Node does, (3) a stale profile without
// function keys specializes nothing and changes nothing, and (4) with function
// keys an edited file keeps the guards of its unchanged functions (re-based to
// their new offsets) and drops those of changed functions.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../src/index.js";
import { instantiateWasmGc } from "../src/backend/wasmgc/host.js";
import { indexSiteProfile, profileFunctions, profileFunctionTable, SITE_PROFILE_SCHEMA, SiteProfileError } from "../src/backend/wasmgc/site-profile.js";

const fixtures = fileURLToPath(new URL("./fixtures/profile-specialization/", import.meta.url));
const entry = join(fixtures, "main.ts"), sitesFile = join(fixtures, "sites.js");
let dir = "", text = "";

/** The span of `inner` inside the first occurrence of `context` in `src`. */
const spanOf = (context: string, inner = context, src = text) => {
  const at = src.indexOf(context);
  if (at < 0 || !context.includes(inner)) throw new Error(`no ${context}`);
  const start = at + context.indexOf(inner);
  return { start, end: start + inner.length };
};

/** The synthetic profile of `src` (sites.js's text when profiled) for `file`,
 * recording `sha`; with `functions`, each site's enclosing function and the
 * function content keys the fallback key needs. */
function profileJson(sha: string, { file = sitesFile, src = text, functions = false } = {}): string {
  const object = (fields: string[], key: string) => ({ kind: "plain-object", fields, own: { index: fields.indexOf(key), how: "field:h" } });
  const fns = profileFunctions(file, src);
  const fnOf = (span: { start: number; end: number }) => {
    const f = fns.filter(f => f.start <= span.start && span.end <= f.end).at(-1);
    return f && functions ? { fn: { start: f.start, end: f.end } } : {};
  };
  const span = (context: string, inner = context) => spanOf(context, inner, src);
  const site = (s: { span: { start: number; end: number } } & Record<string, unknown>) => ({ ...s, file, ...fnOf(s.span) });
  const plus = fns.find(f => src.startsWith("export function plus(", f.start))!, arrow = span("(p, q) => p * q * k");
  return JSON.stringify({
    schema: SITE_PROFILE_SCHEMA,
    files: { [file]: { sha256: sha, ...(functions ? { functions: profileFunctionTable(file, src) } : {}) } },
    sites: [
      site({ kind: "load", property: "x", span: span("return v.x;", "v.x"), state: "monomorphic", receivers: [object(["x", "y"], "x")] }),
      site({ kind: "store", property: "x", span: span("v.x = n;", "v.x"), altSpan: span("v.x = n;", "v.x = n"), state: "monomorphic", receivers: [object(["x", "y"], "x")] }),
      site({ kind: "load", property: "id", span: span("return v.id;", "v.id"), state: "monomorphic", receivers: [object(["id", "value"], "id")] }),
      site({ kind: "load", property: "length", span: span("return v.length;", "v.length"), state: "polymorphic", receivers: [{ kind: "array" }, { kind: "string" }] }),
      site({ kind: "call", span: span("f(a, 2)"), state: "monomorphic", call: { state: "monomorphic", count: 9, targets: [{ kind: "function", name: "plus", file, fn: { start: plus.start, end: plus.end } }] } }),
      site({ kind: "call", span: span("f(a, 3)"), state: "monomorphic", call: { state: "monomorphic", count: 9, targets: [{ kind: "closure-site", file, fn: arrow }] } }),
      // Adds: a constructor's two stores (on its instances), and a store adding z to {x, y}.
      site({ kind: "store", property: "x", span: span("this.x = x;", "this.x"), altSpan: span("this.x = x;", "this.x = x"), state: "monomorphic", receivers: [{ kind: "instance", fields: [], transition: { index: 0 } }] }),
      site({ kind: "store", property: "y", span: span("this.y = y;", "this.y"), altSpan: span("this.y = y;", "this.y = y"), state: "monomorphic", receivers: [{ kind: "instance", fields: ["x"], transition: { index: 1 } }] }),
      site({ kind: "store", property: "z", span: span("o.z = z;", "o.z"), altSpan: span("o.z = z;", "o.z = z"), state: "polymorphic", receivers: [{ kind: "instance", fields: ["x", "y"], transition: { index: 2 } }, { kind: "plain-object", fields: ["x", "y"], transition: { index: 2 } }] }),
      // A megamorphic site and a site that never ran stay generic.
      site({ kind: "load", property: "x", span: { start: 0, end: 1 }, state: "megamorphic", receivers: [] }),
    ],
  });
}

/** Entry counts of the functions matching `pattern` while `run` executes
 * (a probe call at each entry; dev builds keep names and do not inline). */
async function countEntries(bytes: Uint8Array, pattern: RegExp, run: (bytes: Uint8Array) => Promise<void>): Promise<number> {
  const { default: binaryen } = await import("binaryen");
  const b = binaryen as unknown as typeof import("binaryen").default;
  // readBinary takes the feature set as a second argument (not in index.d.ts).
  const m = (b.readBinary as unknown as (bytes: Uint8Array, features: number) => ReturnType<typeof b.readBinary>)(bytes,
    b.Features.GC | b.Features.ReferenceTypes | b.Features.ExceptionHandling | b.Features.BulkMemory | b.Features.SignExt | b.Features.NontrappingFPToInt
    | b.Features.Multivalue | b.Features.TailCall | b.Features.MutableGlobals | b.Features.SIMD128 | b.Features.BulkMemoryOpt | b.Features.Atomics | b.Features.RelaxedSIMD | b.Features.ExtendedConst);
  m.addFunctionImport("$probe.hit", "probe", "hit", b.none, b.none);
  for (let i = 0; i < m.getNumFunctions(); i++) {
    const f = m.getFunctionByIndex(i), info = b.getFunctionInfo(f);
    if (info.module || !info.body || !pattern.test(info.name)) continue;
    (b as unknown as { _BinaryenFunctionSetBody(f: number, body: number): void })._BinaryenFunctionSetBody(f, m.block(null, [m.call("$probe.hit", [], b.none), info.body], info.results));
  }
  b.setDebugInfo(true);
  const out = m.emitBinary(); b.setDebugInfo(false); m.dispose();
  let hits = 0;
  const real = WebAssembly.instantiate;
  (WebAssembly as { instantiate: unknown }).instantiate = (mod: BufferSource, imports?: WebAssembly.Imports) => real.call(WebAssembly, mod, { ...imports, probe: { hit: () => { hits++; } } });
  try { await run(out); } finally { (WebAssembly as { instantiate: unknown }).instantiate = real; }
  return hits;
}

async function runWasm(bytes: Uint8Array, exports?: (e: WebAssembly.Exports) => void): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
  try {
    const m = await instantiateWasmGc(bytes, { onUncaught: (e: unknown) => { throw e; } });
    await m.main();
    exports?.(m.instance.exports);
  } finally { spy.mockRestore(); }
  return lines.join("\n");
}

async function build(name: string, optimization: "dev" | "release", profile?: string, main = entry, extra: { experimentalJsSpecializeCounters?: boolean; experimentalJsSpecializeCoverage?: number } = {}) {
  const outPath = join(dir, `${name}.${optimization}.wasm`);
  const profilePath = profile === undefined ? undefined : join(dir, `${name}.profile.json`);
  if (profilePath) await writeFile(profilePath, profile);
  const r = await compile(main, { outputKind: "wasmgc", browser: true, dynModel: "native", optimization, outDir: dir, outPath,
    ...(profilePath ? { experimentalJsSpecialize: "profile" as const, experimentalJsSpecializeProfile: profilePath, ...extra } : {}) });
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  const report = profilePath ? JSON.parse(await readFile(`${outPath}.specialization.json`, "utf8")) : null;
  const bytes = await readFile(outPath);
  let counts: number[] | null = null;
  const output = await runWasm(bytes, e => {
    if (typeof e["__pgo_sites"] !== "function") return;
    const n = (e["__pgo_sites"] as () => number)(), at = e["__pgo_count"] as (i: number) => number;
    counts = Array.from({ length: 2 * n }, (_, i) => at(i));
  });
  return { output, report, bytes, counts: counts as number[] | null };
}

describe("experimentalJsSpecialize profile", () => {
  let oracle = "", sha = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptc-profile-"));
    text = await readFile(sitesFile, "utf8");
    sha = createHash("sha256").update(text).digest("hex");
    const { observations } = await import(sitesFile) as { observations: (r: unknown) => string };
    oracle = observations({ id: 20, value: 1 });
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  for (const optimization of ["dev", "release"] as const) {
    test(`guards the profiled sites and matches Node (${optimization})`, async () => {
      const plain = await build("plain", optimization);
      expect(plain.output).toBe(oracle);
      const { output, report } = await build("profiled", optimization, profileJson(sha));
      expect(output).toBe(oracle);
      const arms = (kind: string, property?: string) => report.sites.filter((s: { kind: string; property?: string }) => s.kind === kind && s.property === property).map((s: { arms: string[] }) => s.arms.join("+"));
      expect(arms("read", "x")).toEqual(["shape:$pgo.shape.0"]);
      expect(arms("write", "x")).toEqual(["shape:$pgo.shape.0", "add:$pgo.shape.1>$pgo.shape.2"]);
      expect(arms("write", "y")).toEqual(["add:$pgo.shape.2>$pgo.shape.0"]);
      // Both receivers of the polymorphic add share one layout, so one arm.
      expect(arms("write", "z")).toEqual(["add:$pgo.shape.0>$pgo.shape.3"]);
      expect(arms("read", "id")).toHaveLength(1);
      expect(arms("read", "id")[0]).toMatch(/^record:/);
      expect(arms("read", "length")).toEqual(["array+string"]);
      expect(arms("call").map(a => a.replace(/:.*/, "")).sort()).toEqual(["env", "fnval"]);
      expect(report.profile.files[sitesFile].status).toBe("current");
      if (optimization === "dev") {
        // The arms are taken, not just emitted: fewer dispatcher entries,
        // uniform-invoker entries and cached-transition helper entries than
        // the build without the profile.
        const profiled = await build("profiled", optimization, profileJson(sha));
        for (const pattern of [/^_25dyn\.class\.property\./, /^\$dyninv\./, /^\$obj\.setIC$/]) {
          const without = await countEntries(plain.bytes, pattern, async b => { expect(await runWasm(b)).toBe(oracle); });
          const withProfile = await countEntries(profiled.bytes, pattern, async b => { expect(await runWasm(b)).toBe(oracle); });
          expect(withProfile, String(pattern)).toBeLessThan(without);
        }
      }
    }, 120_000);
  }

  test("a counted build counts each guarded site's entries and fallbacks; a coverage policy keeps the hottest", async () => {
    const plainRun = await build("uncounted", "release", profileJson(sha));
    expect(plainRun.counts).toBeNull();
    const { output, report, counts } = await build("counted", "release", profileJson(sha), entry, { experimentalJsSpecializeCounters: true });
    expect(output).toBe(oracle);
    expect(report.counters).toBe(true);
    expect(counts).not.toBeNull();
    const site = (kind: string, property?: string) => report.sites.filter((s: { kind: string; property?: string }) => s.kind === kind && s.property === property);
    const entries = (s: { counter: number }) => counts![2 * s.counter]!, fallbacks = (s: { counter: number }) => counts![2 * s.counter + 1]!;
    expect(report.sites.every((s: { counter?: number }) => typeof s.counter === "number")).toBe(true);
    // readX: the profiled {x, y} receivers take the arm, every other receiver falls through.
    const [readX] = site("read", "x");
    expect(entries(readX)).toBeGreaterThan(fallbacks(readX));
    expect(fallbacks(readX)).toBeGreaterThan(0);
    // Adds: in each of the two transitions() passes, `this.y = y` runs on the
    // {x} layout `this.x = x` just made for five `new Point`, and falls through
    // once (Point.call on a non-fresh receiver).
    const [addY] = site("write", "y");
    expect(fallbacks(addY)).toBe(2);
    expect(entries(addY) - fallbacks(addY)).toBe(2 * 5);
    // Annotate the profile with those hits: a coverage of 0.5 keeps the hottest sites only.
    const profile = JSON.parse(profileJson(sha)), byLoc = new Map(report.sites.map((s: { kind: string; loc: { start: number; end: number }; counter: number }) => [`${s.kind}:${s.loc.start}`, entries(s) - fallbacks(s)]));
    const KIND: Record<string, string> = { load: "read", store: "write", call: "call" };
    let total = 0;
    for (const p of profile.sites) {
      const h = (byLoc.get(`${KIND[p.kind]}:${p.span.start}`) ?? (p.altSpan ? byLoc.get(`${KIND[p.kind]}:${p.altSpan.start}`) : undefined)) as number | undefined;
      if (h !== undefined) { p.hits = h; total += h; }
    }
    profile.counts = { hits: total };
    const hottest = [...profile.sites].filter(p => p.hits).sort((a, b) => b.hits - a.hits)[0];
    const half = await build("covered", "release", JSON.stringify(profile), entry, { experimentalJsSpecializeCoverage: 0.5 });
    expect(half.output).toBe(oracle);
    expect(half.report.profile.coverage).toMatchObject({ requested: 0.5, hits: total });
    expect(half.report.sites.length).toBeLessThan(report.sites.length);
    expect(half.report.sites.some((s: { loc: { start: number } }) => s.loc.start === hottest.span.start || s.loc.start === hottest.altSpan?.start)).toBe(true);
    const all = await build("covered-all", "release", JSON.stringify(profile), entry, { experimentalJsSpecializeCoverage: 1 });
    expect(all.output).toBe(oracle);
    // Coverage 1 keeps every site with hits (the never-run megamorphic site had no guard anyway).
    expect(all.report.sites.length).toBe(report.sites.filter((s: { counter: number }) => entries(s) > fallbacks(s)).length);
  }, 240_000);

  test("a coverage policy needs a counted profile and a fraction in (0, 1]", async () => {
    const outPath = join(dir, "cov.wasm"), profilePath = join(dir, "uncounted.json");
    await writeFile(profilePath, profileJson(sha));
    const base = { outputKind: "wasmgc" as const, browser: true, dynModel: "native" as const, outDir: dir, outPath, experimentalJsSpecialize: "profile" as const, experimentalJsSpecializeProfile: profilePath };
    const uncounted = await compile(entry, { ...base, experimentalJsSpecializeCoverage: 0.9 });
    expect(uncounted.ok).toBe(false);
    expect(uncounted.diagnostics[0]?.message).toContain("counted profile");
    const counted = JSON.parse(profileJson(sha)); counted.counts = { hits: 0 };
    await writeFile(profilePath, JSON.stringify(counted));
    const zero = await compile(entry, { ...base, experimentalJsSpecializeCoverage: 0 });
    expect(zero.ok).toBe(false);
    const noMode = await compile(entry, { outputKind: "wasmgc", browser: true, dynModel: "native", outDir: dir, outPath, experimentalJsSpecializeCoverage: 0.9 });
    expect(noMode.ok).toBe(false);
  }, 120_000);

  test("a stale profile specializes nothing and changes nothing", async () => {
    const { output, report } = await build("stale", "release", profileJson("0".repeat(64)));
    expect(output).toBe(oracle);
    expect(report.profile.files[sitesFile].status).toBe("stale");
    expect(report.sites).toEqual([]);
    expect(report.profile.kept).toBe(0);
  }, 120_000);

  test("an edited file keeps its unchanged functions' guards and drops its changed functions'", async () => {
    // The profile was taken of sites.js as it is; the compiler then reads an
    // edited copy: a function added above everything (every offset shifts)
    // and readId's body rewritten (its function text changes).
    const edited = join(dir, "edited"), editedSites = join(edited, "sites.js");
    await mkdir(edited, { recursive: true });
    const marker = "export function readX(";
    const changed = text.replace(marker, `export function added(v) { return v.w; }\n${marker}`)
      .replace("export function readId(v) { return v.id; }", "export function readId(v) { const id = v.id; return id; }");
    expect(changed).not.toBe(text);
    await writeFile(editedSites, changed);
    await writeFile(join(edited, "main.ts"), await readFile(entry, "utf8"));
    const profile = profileJson(sha, { file: editedSites, src: text, functions: true });
    for (const optimization of ["dev", "release"] as const) {
      const { output, report } = await build(`edited`, optimization, profile, join(edited, "main.ts"));
      expect(output).toBe(oracle);
      const status = report.profile.files[editedSites];
      expect(status.status).toBe("stale");
      // 10 profiled: readId's load and the function-less megamorphic site drop.
      expect(status.fallback).toMatchObject({ profiled: 10, survived: 8 });
      expect(report.profile.survived).toBe(8);
      const arms = (kind: string, property?: string) => report.sites.filter((s: { kind: string; property?: string }) => s.kind === kind && s.property === property).map((s: { arms: string[] }) => s.arms.join("+"));
      expect(arms("read", "x")).toEqual(["shape:$pgo.shape.0"]);
      expect(arms("write", "x")).toEqual(["shape:$pgo.shape.0", "add:$pgo.shape.1>$pgo.shape.2"]);
      expect(arms("write", "z")).toEqual(["add:$pgo.shape.0>$pgo.shape.3"]);
      expect(arms("read", "length")).toEqual(["array+string"]);
      expect(arms("read", "id")).toEqual([]);
      // Both calls kept, their targets (plus, maker's arrow) re-based too.
      expect(arms("call").map(a => a.replace(/:.*/, "")).sort()).toEqual(["env", "fnval"]);
      // Every guard sits at the edited file's offsets.
      const shift = "export function added(v) { return v.w; }\n".length;
      const readX = report.sites.find((s: { kind: string; property?: string }) => s.kind === "read" && s.property === "x");
      expect(readX.loc).toMatchObject({ file: editedSites, start: spanOf("return v.x;", "v.x").start + shift });
    }
  }, 240_000);

  test("refuses a profile without its mode, or an unreadable one", async () => {
    const outPath = join(dir, "bad.wasm");
    const base = { outputKind: "wasmgc" as const, browser: true, dynModel: "native" as const, outDir: dir, outPath };
    const noPath = await compile(entry, { ...base, experimentalJsSpecialize: "profile" });
    expect(noPath.ok).toBe(false);
    const noMode = await compile(entry, { ...base, experimentalJsSpecializeProfile: join(dir, "x.json") });
    expect(noMode.ok).toBe(false);
    await writeFile(join(dir, "wrong.json"), JSON.stringify({ schema: "other", files: {}, sites: [] }));
    const wrong = await compile(entry, { ...base, experimentalJsSpecialize: "profile", experimentalJsSpecializeProfile: join(dir, "wrong.json") });
    expect(wrong.ok).toBe(false);
    expect(wrong.diagnostics[0]?.message).toContain(SITE_PROFILE_SCHEMA);
  }, 120_000);
});

describe("indexSiteProfile", () => {
  const json = JSON.stringify({ schema: SITE_PROFILE_SCHEMA, files: { "/a.js": { sha256: createHash("sha256").update("A").digest("hex") }, "/b.js": { sha256: "x" } },
    sites: [
      { kind: "load", property: "p", file: "/a.js", span: { start: 1, end: 4 }, state: "monomorphic" },
      { kind: "store", property: "p", file: "/a.js", span: { start: 5, end: 8 }, altSpan: { start: 5, end: 12 }, state: "monomorphic" },
      { kind: "load", property: "q", file: "/b.js", span: { start: 1, end: 4 }, state: "monomorphic" },
      { kind: "binary-op", file: "/a.js" },
    ] });
  const index = indexSiteProfile(json, "/p.json", f => f === "/a.js" ? "A" : f === "/b.js" ? "B" : undefined);
  test("keys sites by exact span and alternate span, filtered by kind", () => {
    expect(index.at({ file: "/a.js", start: 1, end: 4 }, ["load"])).toHaveLength(1);
    expect(index.at({ file: "/a.js", start: 1, end: 4 }, ["store"])).toHaveLength(0);
    expect(index.at({ file: "/a.js", start: 5, end: 12 }, ["store"])).toHaveLength(1);
    expect(index.at({ file: "/a.js", start: 5, end: 8 }, ["store"])).toHaveLength(1);
    expect(index.at({ file: "/a.js", start: 1, end: 5 }, ["load"])).toHaveLength(0);
  });
  test("drops the sites of a file whose sha changed", () => {
    expect(index.files["/b.js"]!.status).toBe("stale");
    expect(index.at({ file: "/b.js", start: 1, end: 4 }, ["load"])).toHaveLength(0);
    expect(index.kept).toBe(2);
  });
  test("an edited file re-bases sites of unchanged functions, drops changed ones, and re-bases call targets", () => {
    const before = "function a(o) { return o.p; }\nfunction b(o) { return o.q; }\nfunction c() { return a({ p: 1 }) + b({ q: 2 }); }\n";
    const after = "// a new first line\nfunction a(o) { return o.p; }\nfunction b(o) { return o.q + 1; }\nfunction c() { return a({ p: 1 }) + b({ q: 2 }); }\n";
    const at = (src: string, s: string, inner = s) => { const i = src.indexOf(s) + s.indexOf(inner); return { start: i, end: i + inner.length }; };
    const fns = profileFunctions("/e.js", before), fn = (name: string) => { const f = fns.find(f => before.startsWith(`function ${name}(`, f.start))!; return { start: f.start, end: f.end }; };
    const profile = JSON.stringify({ schema: SITE_PROFILE_SCHEMA,
      files: { "/e.js": { sha256: createHash("sha256").update(before).digest("hex"), functions: profileFunctionTable("/e.js", before) } },
      sites: [
        { kind: "load", property: "p", file: "/e.js", span: at(before, "o.p"), fn: fn("a"), state: "monomorphic" },
        { kind: "load", property: "q", file: "/e.js", span: at(before, "o.q"), fn: fn("b"), state: "monomorphic" },
        { kind: "call", file: "/e.js", span: at(before, "a({ p: 1 })"), fn: fn("c"), state: "monomorphic", call: { state: "monomorphic", count: 1, targets: [{ kind: "function", file: "/e.js", fn: fn("a") }] } },
        { kind: "call", file: "/e.js", span: at(before, "b({ q: 2 })"), fn: fn("c"), state: "monomorphic", call: { state: "monomorphic", count: 1, targets: [{ kind: "function", file: "/e.js", fn: fn("b") }] } },
        // A site whose recorded span no longer holds its property (a corrupt key) is dropped.
        { kind: "load", property: "zz", file: "/e.js", span: at(before, "o.p"), fn: fn("a"), state: "monomorphic" },
      ] });
    const index = indexSiteProfile(profile, "/p.json", f => f === "/e.js" ? after : undefined);
    expect(index.files["/e.js"]).toMatchObject({ status: "stale", sites: 3, fallback: { profiled: 5, survived: 3, functions: 3, unchanged: 2 } });
    expect(index.survived).toBe(3);
    expect(index.dropped).toBe(2);
    expect(index.at({ file: "/e.js", ...at(after, "o.p") }, ["load"]).map(s => s.property)).toEqual(["p"]);
    expect(index.at({ file: "/e.js", ...at(after, "o.q") }, ["load"])).toEqual([]);
    const [callA] = index.at({ file: "/e.js", ...at(after, "a({ p: 1 })") }, ["call"]);
    const fa = profileFunctions("/e.js", after).find(f => after.startsWith("function a(", f.start))!;
    expect(callA!.call!.targets![0]!.fn).toMatchObject({ start: fa.start, end: fa.end });
    const [callB] = index.at({ file: "/e.js", ...at(after, "b({ q: 2 })") }, ["call"]);
    expect(callB!.call!.targets![0]).toMatchObject({ unresolved: "stale" });
    expect(callB!.call!.targets![0]!.fn).toBeUndefined();
  });
  test("resolves relative file paths against the profile and selects entry-tagged sites", () => {
    const json = JSON.stringify({ schema: SITE_PROFILE_SCHEMA, files: { "src/a.js": { sha256: createHash("sha256").update("A").digest("hex") } },
      sites: [
        { kind: "load", property: "p", file: "src/a.js", span: { start: 1, end: 4 }, state: "monomorphic" },
        { kind: "load", property: "q", file: "src/a.js", span: { start: 5, end: 8 }, state: "monomorphic", entry: "one.ts" },
        { kind: "load", property: "q", file: "src/a.js", span: { start: 5, end: 8 }, state: "polymorphic", entry: "two.ts" },
      ] });
    const one = indexSiteProfile(json, "/w/p.json", f => f === "/w/src/a.js" ? "A" : undefined, "/w/one.ts");
    expect(one.files["/w/src/a.js"]!.status).toBe("current");
    expect(one.at({ file: "/w/src/a.js", start: 1, end: 4 }, ["load"])).toHaveLength(1);
    expect(one.at({ file: "/w/src/a.js", start: 5, end: 8 }, ["load"]).map(s => s.state)).toEqual(["monomorphic"]);
    expect(one.otherEntry).toBe(1);
    const neither = indexSiteProfile(json, "/w/p.json", f => f === "/w/src/a.js" ? "A" : undefined, "/w/three.ts");
    expect(neither.at({ file: "/w/src/a.js", start: 5, end: 8 }, ["load"])).toEqual([]);
  });
  test("a coverage policy keeps each counted operation's hottest sites, or the hottest overall", () => {
    const A = createHash("sha256").update("A").digest("hex");
    const site = (start: number, hits: number, ops?: Record<string, number>) => ({ kind: "load", property: "p", file: "/a.js", span: { start, end: start + 1 }, state: "monomorphic", hits, ...(ops ? { ops } : {}) });
    // A heavy operation (mount) and a cheap one (local): over the total, the
    // local operation's only site falls below a 0.9 cut; per operation, it is kept.
    const sites = [site(1, 900, { mount: 900 }), site(3, 60, { mount: 60 }), site(5, 30, { local: 30 }), site(7, 10, { mount: 10 }), site(9, 0)];
    const counted = (ops: boolean) => JSON.stringify({ schema: SITE_PROFILE_SCHEMA, files: { "/a.js": { sha256: A } },
      counts: { hits: 1000, ...(ops ? { ops: { mount: { n: 1, hits: 970 }, local: { n: 1, hits: 30 } } } : {}) }, sites: ops ? sites : sites.map(({ ops: _o, ...s }) => s) });
    const kept = (index: ReturnType<typeof indexSiteProfile>) => [1, 3, 5, 7, 9].filter(start => index.at({ file: "/a.js", start, end: start + 1 }, ["load"]).length);
    const total = indexSiteProfile(counted(false), "/p.json", f => f === "/a.js" ? "A" : undefined, undefined, 0.9);
    expect(kept(total)).toEqual([1]);
    expect(total.coverage).toMatchObject({ by: "total", hits: 1000, keptHits: 900, kept: 1, below: 4 });
    const perOp = indexSiteProfile(counted(true), "/p.json", f => f === "/a.js" ? "A" : undefined, undefined, 0.9);
    expect(kept(perOp)).toEqual([1, 5]);
    expect(perOp.coverage).toMatchObject({ by: "operation", kept: 2, ops: { mount: { hits: 970, keptHits: 900 }, local: { hits: 30, keptHits: 30 } } });
    // Coverage 1 keeps every site with hits, never one without.
    expect(kept(indexSiteProfile(counted(true), "/p.json", f => f === "/a.js" ? "A" : undefined, undefined, 1))).toEqual([1, 3, 5, 7]);
  });
  test("rejects another schema", () => {
    expect(() => indexSiteProfile(JSON.stringify({ schema: "x", files: {}, sites: [] }), "/p.json", () => undefined)).toThrow(SiteProfileError);
  });
});
