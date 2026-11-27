import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../../index.js";
import { MAX_OPTIMIZE_LEVEL, optimiseWasmGcBinary, optimiseWasmGcBinaryWithReceipt } from "./emitter.js";

/** Compiles a small program with SCRIPTC_WASMOPT_STAGED set to `mode` and answers the release binary. */
async function build(mode: string): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "staged-test-")), src = join(dir, "p.ts"), out = join(dir, "p.wasm");
  writeFileSync(src, 'class A { x = 1; f() { return this.x + 1; } }\nconst o: any = { a: 1, b: "s" };\nfunction g(n: number): number { return n < 2 ? n : g(n - 1) + g(n - 2); }\nconsole.log(new A().f(), o.a, o.b, g(10), [1, 2, 3].map((v) => v * 2).join(","));\n');
  const was = process.env["SCRIPTC_WASMOPT_STAGED"];
  process.env["SCRIPTC_WASMOPT_STAGED"] = mode;
  try {
    const r = await compile(src, { outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native" });
    expect(r.ok).toBe(true);
    return new Uint8Array(readFileSync(out));
  } finally { if (was === undefined) delete process.env["SCRIPTC_WASMOPT_STAGED"]; else process.env["SCRIPTC_WASMOPT_STAGED"] = was; }
}

test("the two-process -O2 pipeline (used for large modules) gives a valid module of the same size class as one -O2 run", async () => {
  const single = await build("-1"), staged = await build("0");
  const wa = (globalThis as unknown as { WebAssembly: { validate(bytes: Uint8Array, options?: unknown): boolean } }).WebAssembly;
  expect(wa.validate(staged, { builtins: ["js-string"], importedStringConstants: "'" })).toBe(true);
  expect(Math.abs(staged.length - single.length) / single.length).toBeLessThan(0.05);
}, 240000);

test("the link helper optimizes at the maximum level by default and refuses a higher one", () => {
  const empty = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  expect(MAX_OPTIMIZE_LEVEL).toBe(2);
  expect(optimiseWasmGcBinary(empty).length).toBeGreaterThanOrEqual(8);
  const { receipt } = optimiseWasmGcBinaryWithReceipt(empty);
  expect(receipt).toMatchObject({ level: 2, mode: "single", runs: [{ ok: true }] });
  expect(receipt.runs[0]!.args).toContain("-O2");
  expect(receipt.runs[0]!.args.some((a) => a.startsWith("$tmp/"))).toBe(true);
  // The native wasm-opt when the platform's is vendored, else wasm-opt.js: either way the receipt hashes what ran.
  const tool = receipt.tool;
  if ("native" in tool) expect(tool.nativeSha256).toMatch(/^[0-9a-f]{64}$/);
  else if ("js" in tool) { expect(tool.jsSha256).toMatch(/^[0-9a-f]{64}$/); expect(tool.wasmSha256).toMatch(/^[0-9a-f]{64}$/); }
  else throw new Error("the receipt names no vendored wasm-opt");
  expect(() => optimiseWasmGcBinary(empty, 3)).toThrow(/above the maximum/);
});

test("a staged release records both of its processes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "staged-receipt-")), src = join(dir, "p.ts"), out = join(dir, "p.wasm");
  writeFileSync(src, "console.log([1, 2, 3].map((v) => v * 2).join(\",\"));\n");
  const was = process.env["SCRIPTC_WASMOPT_STAGED"];
  process.env["SCRIPTC_WASMOPT_STAGED"] = "0";
  try {
    const r = await compile(src, { outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native", release: true });
    if (!r.ok || r.artifact.kind !== "wasmgc") throw new Error("compile failed");
    expect(r.artifact.optimizer).toMatchObject({ level: 2, mode: "staged", env: { SCRIPTC_WASMOPT_STAGED: "0" } });
    expect(r.artifact.optimizer!.runs.map((run) => run.ok)).toEqual([true, true]);
  } finally { if (was === undefined) delete process.env["SCRIPTC_WASMOPT_STAGED"]; else process.env["SCRIPTC_WASMOPT_STAGED"] = was; }
}, 240000);

test("the vendored wasm-opt keeps its 4 GiB heap patch", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../../../vendor/binaryen-133/binaryen-version_133");
  const js = readFileSync(join(dir, "wasm-opt.js"), "utf8");
  expect(js).toContain("maximum:65536");
  expect(js).toContain("getHeapMax=()=>4294967296");
});
