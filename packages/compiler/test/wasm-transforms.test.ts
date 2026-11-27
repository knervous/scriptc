import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, type WasmGcTransform } from "../src/index.js";

/** Compile a small browser program to WasmGC with the given transforms; returns what was written. */
async function build(transforms?: readonly WasmGcTransform[], release = false): Promise<{ wasm: Buffer; host: string }> {
  const dir = mkdtempSync(join(tmpdir(), "wasm-transforms-test-"));
  try {
    writeFileSync(join(dir, "main.ts"), 'const parts = ["a", "b"];\nconsole.log(parts.join("+"));\n');
    const out = join(dir, "main.wasm");
    const r = await compile(join(dir, "main.ts"), {
      outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native",
      ...(release ? { release: true } : { optimization: "dev" as const }), ...(transforms ? { wasmTransforms: transforms } : {}),
    });
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics).slice(0, 600));
    return { wasm: readFileSync(out), host: readFileSync(`${out}.host.json`, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("no transform and a transform that returns nothing leave the output as emitted", async () => {
  const plain = await build();
  const seen: { release: boolean; outPath: string; size: number }[] = [];
  const observed = await build([(parts, context) => { seen.push({ release: context.release, outPath: context.outPath, size: parts.binary.length }); }]);
  expect(observed.wasm.equals(plain.wasm)).toBe(true);
  expect(observed.host).toBe(plain.host);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.release).toBe(false);
  expect(seen[0]!.outPath.endsWith("main.wasm")).toBe(true);
  expect(seen[0]!.size).toBe(plain.wasm.length);
}, 240000);

test("transforms run in order, each on what the previous one left, before anything is written", async () => {
  // A custom section appended by the first transform, seen and extended by the second.
  const section = (name: string, payload: Uint8Array): Uint8Array => {
    const nameBytes = new TextEncoder().encode(name);
    const body = Uint8Array.of(nameBytes.length, ...nameBytes, ...payload);
    return Uint8Array.of(0, body.length, ...body);
  };
  const order: string[] = [];
  let emittedLength = 0;
  const out = await build([
    (parts) => { order.push("first"); emittedLength = parts.binary.length; return { binary: Uint8Array.of(...parts.binary, ...section("build.id", Uint8Array.of(1))) }; },
    (parts) => {
      order.push("second");
      expect(parts.binary.length).toBe(emittedLength + 12);
      return { binary: Uint8Array.of(...parts.binary, ...section("build.id", Uint8Array.of(2))), hostImports: [...parts.hostImports] };
    },
  ], true);
  expect(order).toEqual(["first", "second"]);
  expect(out.wasm.length).toBe(emittedLength + 24);
  const module = new WebAssembly.Module(out.wasm, { builtins: ["js-string"] } as WebAssembly.ModuleImports);
  expect(WebAssembly.Module.customSections(module, "build.id").map((b) => new Uint8Array(b)[0])).toEqual([1, 2]);
}, 240000);

test("a transform that returns something other than bytes is an error", async () => {
  await expect(build([() => ({ binary: "not bytes" as unknown as Uint8Array })])).rejects.toThrow(/not a Uint8Array/);
}, 240000);
