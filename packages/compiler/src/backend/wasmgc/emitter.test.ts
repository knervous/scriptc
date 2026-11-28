import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, deserializeModule } from "../../index.js";
import type { IrModule } from "../../ir/ir.js";
import binaryen from "binaryen";
import { emitWasmGcModule } from "./emitter.js";

async function lower(source: string, options: { browser?: boolean } = {}): Promise<IrModule> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-wasmgc-emitter-"));
  try {
    const entry = join(dir, "main.ts");
    const outPath = join(dir, "main.ir.json");
    await writeFile(entry, source);
    const result = await compile(entry, { outDir: dir, outPath, outputKind: "ir", ...options });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    return deserializeModule(await readFile(outPath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The text of the emitted function whose name ends in `name` (the i32-ABI body when there is one). */
function funcText(text: string, name: string): string {
  const funcs = text.split(/\n(?= \(func )/).filter((b) => b.startsWith(" (func "));
  // (a function the entry calls that holds a loop carries the once-loop suffix: it stays out of line)
  const named = (b: string) => b.slice(0, b.indexOf("\n")).split(" ")[2]!.replace(/\.once-loop$/, "");
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

test("an atomic work counter's claims reach a callee as int32, and int32 clamps compare in i32", async () => {
  // The browser target lowers Atomics for WasmGC (an IR-only compile otherwise refuses them).
  const mod = await lower(`
    class Cell {
      readonly cells: Int32Array; readonly index: number;
      constructor(cells: Int32Array, index: number) { this.cells = cells; this.index = index; }
      add(v: number): number { return Atomics.add(this.cells, this.index, v); }
    }
    class Counter {
      readonly cell: Cell; readonly total: number;
      constructor(cells: Int32Array, total: number) { this.cell = new Cell(cells, 0); this.total = total; }
      claim(): number { const job = this.cell.add(1); return job < this.total ? job : -1; }
    }
    function work(out: Uint8Array, band: number): void {
      for (let x = 0; x < 8; x++) out[band * 8 + Math.min(7, Math.max(0, x - 1))] = x;
    }
    const out = new Uint8Array(64), counter = new Counter(new Int32Array(1), 8);
    for (let band = counter.claim(); band >= 0; band = counter.claim()) work(out, band);
    console.log(out.join(","));
  `, { browser: true });
  const text = emitWasmGcModule(mod, { browser: true, text: true }).text!;
  // The claim (an Atomics.add result through two methods) is an int32 at work's call site: work takes the i32 ABI.
  expect(text).toMatch(/\(func \$i32:work(\.once-loop)? /);
  expect(text).toMatch(/\(func \$i32:_25Counter\.claim /);
  // Math.min/Math.max of int32 operands: compare and select, no f64.min or f64.max.
  const work = funcText(text, "work");
  expect(work).not.toMatch(/f64\.(min|max)/);
  expect(work).toMatch(/\(i32\.(lt_s|gt_s)/);
});

test("a loop the program's top level calls stays a function of its own (wasm has no on-stack replacement)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-wasmgc-once-"));
  try {
    const entry = join(dir, "main.ts"), outPath = join(dir, "main.wasm");
    // kernel has one call site, so single-caller inlining would fold it into the entry, which runs once: its loop
    // would then run in the engine's baseline code for the whole program.
    await writeFile(entry, `
      function kernel(a: Float64Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * 2; return s; }
      const a = new Float64Array(100);
      for (let i = 0; i < a.length; i++) a[i] = i;
      let t = 0;
      for (let r = 0; r < 3; r++) t += kernel(a);
      console.log(t);
    `);
    const result = await compile(entry, { outDir: dir, outPath, outputKind: "wasmgc", release: true });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    const module = binaryen.readBinary(await readFile(outPath));
    module.setFeatures(binaryen.Features.All);
    const text = module.emitText();
    const funcs = text.split(/\n(?= \(func )/).filter((b) => b.startsWith(" (func "));
    const loops = funcs.map((b) => (b.match(/\(loop /g) ?? []).length).filter((n) => n > 0);
    // The kernel's loop in one function, the entry's two loops in another.
    expect(loops.sort()).toEqual([1, 2]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);
