import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile } from "../../index.js";

type Liveness = { pruned: number; kept: number; slotsCleared: number; opaqueKinds: Record<number, number> };

/** Compiles `source`; answers the build's async-liveness counters (the compile result's artifact carries them). */
async function build(source: string): Promise<Liveness> {
  const dir = mkdtempSync(join(tmpdir(), "async-liveness-test-"));
  writeFileSync(join(dir, "main.ts"), source);
  const out = join(dir, "main.wasm");
  const r = await compile(join(dir, "main.ts"), { outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native" });
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics).slice(0, 600));
  if (r.artifact.kind !== "wasmgc" || !r.artifact.asyncLiveness) throw new Error("no async liveness counters");
  return r.artifact.asyncLiveness;
}

test("a reference dead after a suspension is cleared from the frame there, not kept by the pending task", async () => {
  // Astra's reproduction: `held` is stored at the first await, read, set to null, and the task suspends again. The store of null
  // is pruned (nothing reads `held` again); the frame slot must still stop holding the object.
  const liveness = await build([
    "const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));",
    "async function retained(): Promise<void> {",
    "  let held: { n: number } | null = { n: 123 };",
    "  await pause();",
    "  console.log(held.n);",
    "  held = null;",
    "  await pause();",
    "  console.log('done');",
    "}",
    "void retained();",
  ].join("\n") + "\n");
  expect(liveness.kept).toBe(0);
  expect(liveness.slotsCleared).toBe(1);
});

test("a reference still read after the next suspension is kept, not cleared", async () => {
  const liveness = await build([
    "const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));",
    "async function kept(): Promise<void> {",
    "  const held = { n: 123 };",
    "  await pause();",
    "  await pause();",
    "  console.log(held.n);",
    "}",
    "void kept();",
  ].join("\n") + "\n");
  expect(liveness.kept).toBe(0);
  expect(liveness.slotsCleared).toBe(0);
});

test("a suspended generator's frame lets go of a value it held across an earlier yield", async () => {
  const liveness = await build([
    "function* steps(): Generator<number, void, unknown> {",
    "  let big: number[] | null = [1, 2, 3];",
    "  yield 1;",
    "  yield big.length;",
    "  big = null;",
    "  yield 0;",
    "  yield 1;",
    "}",
    "const g = steps();",
    "console.log(g.next().value, g.next().value, g.next().value);",
  ].join("\n") + "\n");
  expect(liveness.kept).toBe(0);
  expect(liveness.slotsCleared).toBeGreaterThanOrEqual(1);
});
