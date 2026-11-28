import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile } from "../../index.js";

const WebAssembly = (globalThis as unknown as { WebAssembly: { Memory: new (d: { initial: number; maximum: number; shared: boolean }) => { buffer: ArrayBufferLike } } }).WebAssembly;

// Two instances of one module on one shared link memory (threads=shared: one instance per worker) share the built-in
// allocator's state, so their typed arrays never overlap. Each instance fills its own arrays with its own byte.
test("instances on one shared link memory allocate disjoint typed arrays", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-shared-alloc-"));
  try {
    writeFileSync(join(dir, "main.ts"), [
      "const kept: Uint8Array[] = [];",
      "export function mark(v: number, n: number): void { for (let i = 0; i < n; i++) { const a = new Uint8Array(100); a.fill(v); kept.push(a); } }",
      "export function sum(): number { let s = 0; for (const a of kept) for (let i = 0; i < a.length; i++) s += a[i]!; return s; }", ""].join("\n"));
    const out = join(dir, "main.wasm");
    const r = await compile(join(dir, "main.ts"), { outDir: dir, outPath: out, outputKind: "wasmgc",
      wasmLink: { namespace: "m", exports: ["mark", "sum"], memory: { module: "env", name: "memory", shared: true } } });
    expect(r.ok).toBe(true);
    const { instantiateLinked } = await import("./host.js");
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 64, shared: true });
    const instance = async () => {
      const linked = await instantiateLinked(readFileSync(out), { m: {} }, { env: { memory } });
      await linked.modules["m"]!.main();
      return linked.modules["m"]!.exports as { mark(v: number, n: number): void; sum(): number };
    };
    const a = await instance(), b = await instance();
    a.mark(1, 10); b.mark(2, 10); a.mark(1, 1000); b.mark(2, 1000);
    // Each instance reads back exactly what it wrote: no block was handed to both.
    expect(a.sum()).toBe(1010 * 100);
    expect(b.sum()).toBe(1010 * 100 * 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 240000);
