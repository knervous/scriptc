// Capability modes end to end: the modes a build records, the variants auto builds, and identical program output
// under every mode and every string fallback (docs/capabilities.md §4).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { compile, type CompileOptions } from "../src/index.js";
import { detectCapabilities } from "../src/backend/wasmgc/capabilities.js";
import { instantiateLinked, instantiateWasmGc, loadWasmGc, requiredCapabilities, type WasmGcHostOptions } from "../src/backend/wasmgc/host.js";

const dir = mkdtempSync(join(tmpdir(), "scriptc-wasmgc-caps-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PROGRAM = `
class P { constructor(public x: number, public y: number) {} }
const ps: P[] = [];
for (let i = 0; i < 10; i++) ps.push(new P(i, i * 2));
let s = 0;
for (const p of ps) s += p.x + p.y;
try { if (s > 10) throw new Error("big " + s); } catch (e) { console.log("caught", (e as Error).message); }
let t = "";
for (let i = 0; i < 20; i++) t = (t + String.fromCodePoint(97 + i)).substring(i > 8 ? 1 : 0);
console.log("sum", s, t, t.length, t.charCodeAt(2), t === "lmnopqrst", "é".length);
`;
const VIEWS = `
const b = new Uint8Array(4); b[0] = 42;
const sink: any = (globalThis as any).sink;
console.log(sink(b), b.length);
`;

async function build(name: string, source: string, options: Partial<CompileOptions>): Promise<string> {
  const entry = join(dir, `${name}.ts`), outPath = join(dir, `${name}.wasm`);
  writeFileSync(entry, source);
  const r = await compile(entry, { outDir: dir, outPath, outputKind: "wasmgc", ...options } as CompileOptions);
  if (!r.ok) throw new Error(r.diagnostics.map(d => d.message).join("\n"));
  return outPath;
}

async function run(bytes: Uint8Array, opts: WasmGcHostOptions = {}): Promise<{ out: string; fallbacks: string[] }> {
  const out: string[] = [];
  const inst = await instantiateWasmGc(bytes, { log: (...a) => out.push(a.join(" ")), error: (...a) => out.push(a.join(" ")), ...opts });
  // A page program (browser: true) writes to the page's own console.
  const pageLog = console.log;
  console.log = (...a: unknown[]) => { out.push(a.join(" ")); };
  try { await inst.main(); } finally { console.log = pageLog; }
  return { out: out.join("\n"), fallbacks: inst.capabilities.fallbacks };
}

test("every mode and every string fallback prints the same", async () => {
  const baseline = await build("baseline", PROGRAM, {});
  const legacy = await build("legacy", PROGRAM, { capabilities: "baseline,eh=legacy" });
  const bytes = new Uint8Array(readFileSync(baseline));
  expect(requiredCapabilities(bytes)?.key).toBe("wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=off");
  expect(requiredCapabilities(new Uint8Array(readFileSync(legacy)))?.requires).toContain("legacy-eh");
  // The engine's own strings where it has them (Node 22 has no imported constants: strict refuses there).
  const caps = detectCapabilities();
  const native = caps["js-string-builtins"] && caps["imported-string-constants"];
  if (!native) await expect(run(bytes, { strings: "engine" })).rejects.toThrow(/this engine lacks it/);
  const reference = await run(bytes, { strings: native ? "engine" : "polyfill" });
  expect(reference.out).toContain("caught big 135");
  for (const strings of ["auto", "constants", "polyfill"] as const) {
    const r = await run(bytes, { strings });
    expect(r.out).toBe(reference.out);
    if (strings === "polyfill") expect(r.fallbacks).toEqual(["strings:constants", "strings:polyfill"]);
    if (strings === "constants") expect(r.fallbacks).toEqual(["strings:constants"]);
  }
  expect((await run(new Uint8Array(readFileSync(legacy)))).out).toBe(reference.out);
  // The sidecar carries the same record, and the bare host.json is unchanged in form.
  expect(JSON.parse(readFileSync(`${baseline}.capabilities.json`, "utf8")).key).toBe(requiredCapabilities(bytes)!.key);
  expect(Array.isArray(JSON.parse(readFileSync(`${baseline}.host.json`, "utf8")))).toBe(true);
  // The compiler alone builds no variant set.
  expect(existsSync(`${baseline}.variants.json`)).toBe(false);
});

test("strict capabilities refuse the string fallback an engine without string support needs", async () => {
  const bytes = new Uint8Array(readFileSync(await build("strict", PROGRAM, {})));
  // Compiled without the string options, the module lists its string imports, as on an engine without them.
  const plain = await WebAssembly.compile(bytes);
  await expect(instantiateLinked(plain, { "": { capabilities: "strict" } })).rejects.toThrow(/imported string constants/);
  const auto = await instantiateLinked(await WebAssembly.compile(bytes), { "": { log: () => {} } });
  expect(auto.capabilities.fallbacks).toEqual(["strings:constants", "strings:polyfill"]);
});

test("byte views: a fixed memory needs no resizable buffers, and auto builds it as the compat variant", async () => {
  (globalThis as { sink?: unknown }).sink = (u8: Uint8Array) => `len=${u8.length} first=${u8[0]}`;
  const proto = WebAssembly.Memory.prototype as { toResizableBuffer?: unknown };
  const saved = Object.getOwnPropertyDescriptor(proto, "toResizableBuffer");
  // Every engine here runs as one without the integration (Node 24 has none; Node 26 has it, deleted for the test).
  delete proto.toResizableBuffer;
  detectCapabilities(true);
  try {
    const wasm = await build("views", VIEWS, { browser: true, capabilities: "auto", targets: "chrome>=137,node>=24.15" });
    const set = JSON.parse(readFileSync(`${wasm}.variants.json`, "utf8"));
    expect(set.variants.map((v: { key: string }) => v.key)).toEqual([
      "wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=off", "wgc-cap/1;eh=exnref;views=fixed:256;relaxed=0;threads=off"]);
    await expect(run(new Uint8Array(readFileSync(wasm)))).rejects.toThrow(/toResizableBuffer \(Chrome 144/);
    const compat = await run(new Uint8Array(readFileSync(join(dir, "views.compat.wasm"))));
    expect(compat.out).toBe("len=4 first=42 4");
    // The loader picks the variant this engine runs, and downloads only that one.
    const read: string[] = [];
    const loaded = await loadWasmGc(new URL(`file://${wasm}.variants.json`), {
      read: async (u) => { read.push(u.pathname.split("/").pop()!); return new Uint8Array(readFileSync(u)); },
      log: () => {},
    });
    expect(loaded.variant).toBe("views.compat.wasm");
    expect(read).toEqual(["views.wasm.variants.json", "views.compat.wasm"]);
  } finally {
    if (saved) Object.defineProperty(proto, "toResizableBuffer", saved);
    detectCapabilities(true);
  }
});
