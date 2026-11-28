/* The plain WasmGC lane (outputKind "wasmgc" without `browser`: the model a
 * non-browser WasmGC compile gets, with neither native nor engine dyn), run
 * in-process and compared with Node on the same source. Each program pins a
 * defect that lane had:
 *   - a class instance assigned to an interface a method satisfies (class arms
 *     are now the default for every WasmGC compile; the LLVM lane keeps them
 *     opt-in, checked below);
 *   - abstract properties read and written through base-typed receivers;
 *   - `+` over a caught error's message once the module has closures (the
 *     ToPrimitive and function-to-host paths are native-dyn only);
 *   - Number(x) over dynamically held values;
 *   - a JavaScript function's own `this` binding, which the lane has no receiver for;
 *   - typed records, arrays and tuples handed to untyped code (dyn reads saw none of their fields);
 *   - a DataView held in a class field, read by methods over integer and double offsets.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { format } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";
import { instantiateWasmGc } from "../src/backend/wasmgc/host.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const programs = [
  "packages/compiler/test/fixtures/wasmgc-plain/fix-1127-class-method-interface.ts",
  "packages/compiler/test/fixtures/wasmgc-plain/js-function-this-unbound.ts",
  "packages/compiler/test/fixtures/wasmgc-plain/typed-values-into-any.ts",
  "tests/corpus/4726-fix-1127-abstract-property-implementations.ts",
  "tests/corpus/4727-fix-1127-catch-message-concat-after-await.ts",
  "tests/corpus/4728-fix-1127-number-of-dynamic-values.ts",
  "tests/corpus/4734-dataview-method-offsets.ts",
  "tests/corpus/4735-bigint-callbacks-runtime-optional.ts",
  "tests/corpus/4736-functions-mapped-and-stored.ts",
];

async function runPlain(entry: string): Promise<{ stdout: string; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-wasmgc-plain-"));
  try {
    const outPath = join(dir, "p.wasm");
    const r = await compile(entry, { outputKind: "wasmgc", outDir: dir, outPath });
    expect(r.ok, r.ok ? "" : r.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n")).toBe(true);
    const stdout: string[] = [];
    const stderr: string[] = [];
    let uncaught: unknown = null;
    const m = await instantiateWasmGc(await readFile(outPath), {
      log: (...v: unknown[]) => stdout.push(format(...v) + "\n"),
      error: (...v: unknown[]) => stderr.push(format(...v) + "\n"),
      onUncaught: (e: unknown) => { uncaught = e; },
    });
    await m.main();
    // Timers and microtasks settle as Node's loop would (8 s cap).
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 0));
    while (uncaught === null && m.pendingTimers() > 0 && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 2));
    m.stopTimers();
    expect(uncaught).toBe(null);
    return { stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("plain WasmGC lane matches Node", () => {
  for (const program of programs) {
    test(program, async () => {
      const entry = join(repoRoot, program);
      const [mine, node] = await Promise.all([runPlain(entry), execFileAsync(process.execPath, [entry])]);
      expect(mine.stdout).toBe(node.stdout);
      expect(mine.stderr).toBe(node.stderr);
    });
  }
});

describe("class arms on the LLVM lane", () => {
  const entry = join(repoRoot, programs[0]!);
  test("stay opt-in: the width copy still declines a method-satisfied interface", async () => {
    const r = await compile(entry, { outputKind: "ir" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.map((d) => d.code)).toContain("SC2002");
  });
  test("interfaceClassArms: true compiles it and the binary matches Node", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptc-arms-llvm-"));
    try {
      const r = await compile(entry, { outDir: dir, outPath: join(dir, "a.out"), interfaceClassArms: true });
      expect(r.ok, r.ok ? "" : r.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n")).toBe(true);
      if (!r.ok) return;
      const [native, node] = await Promise.all([execFileAsync(r.binaryPath), execFileAsync(process.execPath, [entry])]);
      expect(native.stdout).toBe(node.stdout);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
