// The release contract (docs/WASMGC_RELEASE_CONTRACT.md in the main repo):
//   1. a supported program builds with { release: true } and gets a manifest;
//   2. a program with a reachable compiler fence fails, one diagnostic per site;
//   3. a dev-optimized release build is refused;
//   4. a module built for another host ABI is refused at instantiation;
//   5. a module importing a shared memory declares cross-origin isolation;
//   6. JSPI: a suspending import is reachable only from promising link
//      exports; every other path is refused at compile time;
//   7. the checker-proved-unreachable trap after a non-void body (SC9002)
//      is not an unsupported operation and does not fail admission.
//   node release-contract.mjs      (exit 0 = all hold)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../packages/compiler/dist");
const { compile } = await import(path.join(dist, "index.js"));
const { instantiateWasmGc } = await import(path.join(dist, "backend/wasmgc/host.js"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-contract-"));
const write = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
const base = { outputKind: "wasmgc", browser: true, dynModel: "native", release: true };
let failures = 0;
const check = async (name, f) => { try { await f(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); } };

await check("supported program: optimized artifact + manifest", async () => {
  const entry = write("ok.ts", `import { double } from "./okh.js";\nconst n: number = double(21);\nconsole.log(n);\n`);
  write("okh.js", `export function double(x) { return x * 2; }\n`);
  const out = path.join(dir, "ok.wasm");
  const r = await compile(entry, { ...base, outDir: dir, outPath: out });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics?.map((d) => d.message)));
  const manifest = JSON.parse(fs.readFileSync(out + ".manifest.json", "utf8"));
  assert.equal(manifest.manifest, "scriptc-wasmgc-release/1");
  assert.equal(manifest.hostAbi, "scriptc-wasmgc-host/6");
  assert.equal(manifest.dynModel, "native");
  assert.ok(manifest.hostImports.length > 0 && manifest.browserCapabilities.includes("WebAssembly GC"));
  assert.match(manifest.trust, /trusted application integration/);
});

await check("reachable compiler fence: build fails at the source site", async () => {
  // for-of over a statically-number value is a deferred compiler fence (SC2001).
  write("fenceh.js", `export function walk() { let n = 5; let s = 0; for (const z of n) s += z; return s; }\n`);
  const entry = write("fence.ts", `import { walk } from "./fenceh.js";\nconsole.log(String(walk()));\n`);
  const r = await compile(entry, { ...base, outDir: dir, outPath: path.join(dir, "fence.wasm") });
  assert.equal(r.ok, false, "expected the release build to fail");
  const d = r.diagnostics.find((x) => /release build: this operation is not supported/.test(x.message));
  assert.ok(d, `no release fence diagnostic: ${r.diagnostics.map((x) => x.message).join(" | ")}`);
  assert.match(d.loc.file, /fenceh\.js$/);
  assert.ok(!fs.existsSync(path.join(dir, "fence.wasm")), "no artifact may be written");
});

await check("dev-optimized release is refused", async () => {
  const entry = write("dev.ts", `console.log("x");\n`);
  const r = await compile(entry, { ...base, optimization: "dev", outDir: dir, outPath: path.join(dir, "dev.wasm") });
  assert.equal(r.ok, false);
  assert.match(r.diagnostics[0].message, /release build cannot use optimization "dev"/);
});

await check("host ABI mismatch is refused at instantiation", async () => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, "ok.wasm")));
  // Rewrite the recorded ABI's last digit ("/1" -> "/0") in place.
  const needle = new TextEncoder().encode("scriptc-wasmgc-host/6");
  const at = bytes.findIndex((_, i) => needle.every((b, j) => bytes[i + j] === b));
  assert.ok(at >= 0, "the artifact records its host ABI");
  const patched = bytes.slice(); patched[at + needle.length - 1] = "0".charCodeAt(0);
  await assert.rejects(instantiateWasmGc(patched, {}), /built for host ABI "scriptc-wasmgc-host\/0"/);
  const good = await instantiateWasmGc(bytes, { log: () => {} });
  good.main();
});

await check("shared memory: the manifest declares cross-origin isolation", async () => {
  const entry = write("shm.ts", `const a = new Int32Array(4);\nAtomics.add(a, 0, 2);\nconsole.log(String(Atomics.load(a, 0)));\n`);
  const out = path.join(dir, "shm.wasm");
  const r = await compile(entry, { ...base, outDir: dir, outPath: out, wasmLink: { memory: { module: "env", name: "memory", shared: true }, exports: [] } });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics?.map((d) => d.message)));
  const caps = JSON.parse(fs.readFileSync(out + ".manifest.json", "utf8")).browserCapabilities;
  assert.ok(caps.some((c) => /cross-origin isolation/.test(c)) && caps.includes("shared WebAssembly.Memory"), JSON.stringify(caps));
  assert.ok(!caps.some((c) => /toResizableBuffer/.test(c)), "a shared memory needs no resizable buffer");
});

await check("JSPI: suspension only from promising exports", async () => {
  const manifest = write("jspi.json", JSON.stringify({ ffi_format: 6, libraries: [],
    functions: [{ name: "wait", symbol: "wait", params: ["f64"], returns: "f64", suspending: true }] }));
  const build = async (name, body, link) => {
    const entry = write(`${name}.ts`, `declare function wait(x: number): number;\n${body}\n`);
    return compile(entry, { ...base, outDir: dir, outPath: path.join(dir, `${name}.wasm`), ffiProfilePath: manifest, wasmLink: { namespace: "m", ...link } });
  };
  const ok = await build("jspi-ok", "function step(x: number): number { return wait(x) + 1; }\nexport function run(x: number): number { return step(x); }", { exports: ["run"], promising: ["run"] });
  assert.equal(ok.ok, true, JSON.stringify(ok.diagnostics?.map((d) => d.message)));
  const mod = new WebAssembly.Module(fs.readFileSync(path.join(dir, "jspi-ok.wasm")), { builtins: ["js-string"], importedStringConstants: "'" });
  assert.ok(WebAssembly.Module.imports(mod).some((i) => i.module === "jspi" && i.name === "wait"), "the suspending import comes from module jspi");
  assert.ok(WebAssembly.Module.exports(mod).some((e) => e.name === "m.$promising.run"), "the promising export says so in its name");
  const refused = async (name, body, link, pattern) => {
    const r = await build(name, body, link);
    assert.equal(r.ok, false, `${name} should be refused`);
    assert.ok(r.diagnostics.some((d) => pattern.test(d.message)), `${name}: ${r.diagnostics.map((d) => d.message).join(" | ")}`);
  };
  await refused("jspi-plain", "export function run(x: number): number { return wait(x); }", { exports: ["run"] }, /list the link export in wasmLink.promising/);
  await refused("jspi-value", "const f = (x: number): number => wait(x);\nexport function run(x: number): number { return f(x); }", { exports: ["run"], promising: ["run"] }, /used as a function value/);
  await refused("jspi-init", "console.log(String(wait(1)));", {}, /during module initialization/);
  await refused("jspi-async", "async function a(): Promise<number> { return wait(1); }\nexport function run(x: number): number { a(); return x; }", { exports: ["run"], promising: ["run"] }, /async functions and generators/);
});

await check("a link export named like the module's own export is refused, never an ICE", async () => {
  for (const [name, exports, pattern] of [["link-main", ["main"], /export name "main" is already taken/], ["link-dup", ["main2", "main2"], /export name "main2" is already taken/]]) {
    const entry = write(`${name}.ts`, `export function main(): number { return 1; }\nexport function main2(): number { return 2; }\n`);
    const r = await compile(entry, { ...base, outDir: dir, outPath: path.join(dir, `${name}.wasm`), wasmLink: { namespace: "m", exports } });
    assert.equal(r.ok, false, `${name} should be refused`);
    assert.ok(r.diagnostics.some((d) => pattern.test(d.message)), `${name}: ${r.diagnostics.map((d) => d.message).join(" | ")}`);
  }
});

await check("proved-unreachable fallthrough trap is admitted", async () => {
  const entry = write("fallthrough.ts", `function pick(x: number): number {\n  try { if (x > 0) return 1; throw new Error("neg"); } catch (e) { return -1; }\n}\nconsole.log(String(pick(2) + pick(-2)));\n`);
  const r = await compile(entry, { ...base, outDir: dir, outPath: path.join(dir, "fallthrough.wasm") });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics?.map((d) => d.message)));
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : "\nrelease contract holds");
process.exit(failures ? 1 : 0);
