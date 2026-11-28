/* math=strict canonicalises every NaN a program stores into a Float32Array, a Float64Array or through DataView, so a
 * NaN's bits do not depend on whether the optimiser folded the expression that made it (docs/intrinsics.md). */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";
import { instantiateWasmGc } from "../src/backend/wasmgc/host.js";

const entry = fileURLToPath(new URL("./fixtures/strict-nan/nan-bits.ts", import.meta.url));

async function run(capabilities: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-strict-nan-"));
  try {
    const outPath = join(dir, "p.wasm");
    const r = await compile(entry, { outputKind: "wasmgc", outDir: dir, outPath, capabilities, release: true });
    expect(r.ok, r.ok ? "" : r.diagnostics.map((d) => d.message).join("\n")).toBe(true);
    const out: string[] = [];
    const m = await instantiateWasmGc(await readFile(outPath), { log: (...v: unknown[]) => out.push(format(...v)) });
    await m.main();
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("NaN bits", () => {
  test("math=strict: folded and run-time NaNs store the canonical NaN", async () => {
    const out = await run("baseline,math=strict");
    expect(out).toEqual([
      "dataview 7ff8000000000000 7ff8000000000000",
      "float64array 7ff8000000000000 7ff8000000000000 7ff8000000000000 7ff8000000000000",
      "float32array 7fc00000",
    ]);
  });
  test("math=fast: a stored NaN keeps the bits the engine computed (documented, not canonical)", async () => {
    const out = await run("baseline");
    expect(out[0]).toMatch(/^dataview 7ff8000000000000 [0-9a-f]{16}$/);
  });
});
