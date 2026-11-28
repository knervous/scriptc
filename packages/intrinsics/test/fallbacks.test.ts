/* The intrinsic libraries' plain-JavaScript paths: each fallback computes
 * what the engine (or the lowering it stands in for) computes, and the
 * generators produce working code. Compiled lowering is pinned by the
 * differential corpus (tests/corpus/4729-4732). */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import * as soft from "../f16.ts";
import * as math from "../math.ts";
import { cStruct, layout, layoutSource, RecordView, wgslStruct } from "../layout.ts";
import { intrinsicPragma } from "../../compiler/src/ir/intrinsic-libraries.ts";

describe("f16", () => {
  test("the software conversion equals the engine's on every pattern and every tie", async () => {
    const engine = await import("../f16.engine.mjs");
    expect(engine.F16_PATH).toBe(typeof Math.f16round === "function" ? "engine" : "software");
    for (let h = 0; h < 65536; h++) {
      const v = soft.fromF16Bits(h);
      expect(Object.is(v, engine.fromF16Bits(h)) || (v !== v && engine.fromF16Bits(h) !== engine.fromF16Bits(h))).toBe(true);
      if (v === v && h < 0x7c00) {
        const mid = (v + soft.fromF16Bits(h + 1)) / 2;
        expect(soft.toF16Bits(mid)).toBe(engine.toF16Bits(mid));
      }
      expect(soft.toF16Bits(v)).toBe(engine.toF16Bits(v));
    }
    for (const x of [65519.99, 65520, -65520, 1e-9, 2.98023223876953125e-8, Infinity, -0, NaN]) expect(soft.toF16Bits(x)).toBe(engine.toF16Bits(x));
    expect(soft.toF16Bits(NaN)).toBe(0x7e00);
  });
});

describe("math", () => {
  test("the generated port equals V8's Math on its fdlibm functions", () => {
    const names = ["sin", "cos", "tan", "asin", "acos", "atan", "exp", "expm1", "log", "log1p", "log2", "log10", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "cbrt"] as const;
    let rng = 7;
    const xs = [0, -0, 1, -1, 0.5, 1e-300, 1e300, 710, NaN, Infinity, -Infinity];
    for (let i = 0; i < 3000; i++) { rng = (Math.imul(rng, 1103515245) + 12345) | 0; xs.push((rng / 2147483648) * (i % 5 === 0 ? 1e4 : 3)); }
    for (const name of names) for (const x of xs) expect(Object.is(math[name](x), Math[name](x))).toBe(true);
  });
  test("NaN results are the canonical NaN", () => {
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, math.log(-1), true);
    expect(bits.getBigUint64(0, true)).toBe(0x7ff8000000000000n);
  });
});

describe("layout", () => {
  const P = layout("Particle", [{ name: "pos", type: "f32", count: 3 }, { name: "id", type: "u16" }, { name: "kind", type: "u8" }, { name: "seq", type: "u64" }]);
  test("offsets follow C's rules", () => {
    expect(P.fields.map((f) => [f.name, f.offset])).toEqual([["pos", 0], ["id", 12], ["kind", 14], ["seq", 16]]);
    expect([P.size, P.align, P.stride]).toEqual([24, 8, 24]);
    expect(layout("Q", [{ name: "a", type: "u8" }, { name: "b", type: "f64" }], { packed: true }).stride).toBe(9);
    expect(cStruct(P)).toContain("uint8_t _pad0[1];");
    expect(() => wgslStruct(P)).toThrow(/no WGSL storage type/);
  });
  test("the generated view class reads and writes what RecordView does, in place", async () => {
    const dir = await mkdtemp(join(tmpdir(), "layout-"));
    try {
      const file = join(dir, "particle.ts");
      await writeFile(file, layoutSource(P));
      const { ParticleView, PARTICLE_STRIDE } = await import(pathToFileURL(file).href);
      expect(PARTICLE_STRIDE).toBe(24);
      const bytes = new Uint8Array(24 * 4 + 3);
      const view = new ParticleView(bytes.subarray(3), 4), raw = new RecordView(bytes.subarray(3), 24, 4);
      view.setPos(2, 1, 1.5); view.setId(2, 0xbeef); view.setKind(3, 7); view.setSeq(1, 2n ** 63n + 5n);
      expect(raw.f32(2, 4)).toBe(1.5);
      expect(raw.u16(2, 12)).toBe(0xbeef);
      expect(raw.u8(3, 14)).toBe(7);
      expect(raw.view.getBigUint64(24 + 16, true)).toBe(2n ** 63n + 5n);
      expect(bytes[3 + 2 * 24 + 12]).toBe(0xef);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test("the pragma is read from the leading comments only", () => {
  expect(intrinsicPragma("/* @scriptc-intrinsics int/1 */\nexport {}")).toEqual({ library: "int", version: 1 });
  expect(intrinsicPragma("// This file was modified\n// @scriptc-intrinsics math/2\nx")).toEqual({ library: "math", version: 2 });
  expect(intrinsicPragma("const a = 1; /* @scriptc-intrinsics int/1 */")).toBe(null);
  expect(intrinsicPragma("﻿  /* note */ /* @scriptc-intrinsics f16/1 */")).toEqual({ library: "f16", version: 1 });
});
