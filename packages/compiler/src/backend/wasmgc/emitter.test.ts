import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, deserializeModule } from "../../index.js";
import type { IrModule } from "../../ir/ir.js";
import { emitWasmGcModule } from "./emitter.js";

async function lower(source: string): Promise<IrModule> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-wasmgc-emitter-"));
  try {
    const entry = join(dir, "main.ts");
    const outPath = join(dir, "main.ir.json");
    await writeFile(entry, source);
    const result = await compile(entry, { outDir: dir, outPath, outputKind: "ir" });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    return deserializeModule(await readFile(outPath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The text of the emitted function whose name ends in `name` (the i32-ABI body when there is one). */
function funcText(text: string, name: string): string {
  const funcs = text.split(/\n(?= \(func )/).filter((b) => b.startsWith(" (func "));
  const named = (b: string) => b.slice(0, b.indexOf("\n")).split(" ")[2]!;
  const found = funcs.find((b) => named(b) === `$i32:${name}`) ?? funcs.find((b) => named(b) === `$${name}`);
  if (!found) throw new Error(`no function ${name}`);
  return found;
}
/** f32 locals read straight into f64 arithmetic: one promote per read. */
const promotedLocalReads = (body: string): number => body.match(/\(f64\.promote_f32\s+\(local\.get /g)?.length ?? 0;

test("a bounds-versioned body keeps Float32Array reads used in f64 math across a loop as f64 locals", async () => {
  const mod = await lower(`
    function batch(dst: Float32Array, a: Float32Array, b: Float32Array, count: number): void {
      const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!, a3 = a[3]!;
      for (let n = 0; n < count; n++) {
        const o = n * 4;
        for (let t = o; t < o + 4; t += 2) {
          const b0 = b[t]!, b1 = b[t + 1]!;
          dst[t] = a0 * b0 + a2 * b1;
          dst[t + 1] = a1 * b0 + a3 * b1;
        }
      }
    }
    function rounded(a: Float32Array, n: number): number {
      const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!;
      let acc = Math.fround(0);
      for (let i = 0; i < n; i++) acc = Math.fround(acc + Math.fround(a0 * a1));
      return acc > a2 ? acc : a2;
    }
    function once(a: Float32Array): number { const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!; return a0 * 2 + a1 * 3 + a2 * 4; }
    function into(a: Float32Array, b: Float32Array, out: Float32Array): void {
      const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!, a3 = a[3]!;
      for (let c = 0; c < 4; c++) { const b0 = b[c * 2]!, b1 = b[c * 2 + 1]!; out[c * 2] = b0 * a0 + b1 * a2; out[c * 2 + 1] = b0 * a1 + b1 * a3; }
    }
    const f = new Float32Array(16);
    batch(f, f, f, 2);
    into(f, f, f);
    console.log(rounded(f, 3), once(f));
  `);
  const text = emitWasmGcModule(mod, { browser: true, text: true }).text!;
  // The loop reads each coefficient in f64 arithmetic: f64 locals, promoted once at their f32 loads.
  const batch = funcText(text, "batch");
  expect(batch).toMatch(/\(f32\.load/);
  expect(promotedLocalReads(batch)).toBe(0);
  // Read only by fround arithmetic and an f32 comparison: f32 locals and f32 instructions.
  const rounded = funcText(text, "rounded");
  expect(rounded).toMatch(/\(f32\.mul\s+\(local\.get /);
  expect(rounded).toMatch(/\(f32\.gt\s+\(local\.get /);
  // Each read once, outside any loop: as many conversions either way, so the f32 locals stay.
  expect(promotedLocalReads(funcText(text, "once"))).toBe(3);
  // A loop of four literal trips is no loop level, and b0 and b1 are read in the iteration that writes them: all stay
  // f32 (an f64 copy of the coefficients measured slower in the fork's mat4 multiply-into).
  expect(promotedLocalReads(funcText(text, "into"))).toBe(8);
});
