/* Fixed-width integer contracts (contracts/check.ts): each program either
 * compiles, with the proven slots recorded for the backends, or is refused
 * with SC7002 naming the write (SC7003 for a contract it cannot check) that may break its contract. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

const intLib = fileURLToPath(new URL("../../intrinsics/int.ts", import.meta.url));

async function diagnose(source: string): Promise<{ ok: boolean; messages: string[]; contracts?: Record<string, string[]> }> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-contracts-"));
  try {
    const entry = join(dir, "main.ts");
    await writeFile(entry, `import { toInt8, toUint16, popcnt, mulWrap64 } from ${JSON.stringify(intLib)};\nimport type { Int8, Uint8, Int16, Uint16, Int32, Uint32, Int64, Uint64 } from ${JSON.stringify(intLib)};\n${source}\n`);
    const outPath = join(dir, "main.json");
    const r = await compile(entry, { outputKind: "ir", outDir: dir, outPath });
    if (!r.ok) return { ok: false, messages: r.diagnostics.map((d) => `${d.code} ${d.message}`) };
    const { readFile } = await import("node:fs/promises");
    const ir = JSON.parse(await readFile(outPath, "utf8")) as { contracts?: Record<string, string[]> };
    return { ok: true, messages: [], contracts: ir.contracts };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const accepted: [string, string][] = [
  ["bitwise results", "let x: Int32 = 1; x = (x * 3) | 0; const y: Uint32 = x >>> 0; console.log(x, y);"],
  ["bounded loop counter", "const xs = [1, 2, 3]; let s: Int32 = 0; for (let i: Int32 = 0; i < xs.length; i++) s = (s + xs[i]!) | 0; console.log(s);"],
  ["masks and narrowing", "class P { r: Uint8 = 0; g: Int8 = 0; w: Uint16 = 0; set(v: number) { this.r = v & 0xff; this.g = toInt8(v); this.w = toUint16(v * 7); } } const p = new P(); p.set(300); console.log(p.r, p.g, p.w);"],
  ["intrinsic results", "function bits(v: number): Int32 { return popcnt(v); } const n: Int32 = bits(0xff); const c: Int8 = popcnt(n); console.log(n, c);"],
  ["64-bit by construction", "let h: Uint64 = 0xcbf29ce484222325n; h = mulWrap64(h ^ 97n, 0x100000001b3n); h = h ^ (h >> 33n); const m: Uint64 = h & 0xffn; const s: Int64 = BigInt.asIntN(64, h); console.log(h, s, m);"],
  ["direct calls with proven arguments", "function f(a: Int32, b: Uint8): Int32 { return (a + b) | 0; } console.log(f(5, 200), f(-1 | 0, 7));"],
];
const refused: [string, string, RegExp][] = [
  ["division", "let x: Int32 = 1; x = x / 3; console.log(x);", /the value stored into 'x' \(Int32\) is not provably an int32: 'x \/ 3'/],
  ["fractional argument", "function f(a: Int32): number { return a; } console.log(f(1.5));", /the argument for 'a' \(Int32\) is not provably an int32: '1\.5'/],
  ["unbounded increment", "let i: Int32 = 0; while (Math.random() < 2) { i++; if (i > 5) break; } console.log(i);", /'i' \(Int32\) is not provably an int32: 'i\+\+'/],
  ["unsigned into signed", "const a: Uint32 = 0xffffffff >>> 0; const b: Int32 = a; console.log(b);", /the value stored into 'b' \(Int32\) is not provably an int32: 'a'/],
  ["byte field from a number", "class P { r: Uint8 = 0; set(v: number) { this.r = v; } } const p = new P(); p.set(3); console.log(p.r);", /the value stored into 'P\.r' \(Uint8\) is not provably an integer in \[0, 255\]/],
  ["bigint product", "let h: Uint64 = 1n; h = h * 3n; console.log(h);", /'h' \(Uint64\) is not provably a bigint in \[0, 2\^64 - 1\]: 'h \* 3n'/],
  ["function value", "function f(a: Int32): Int32 { return a; } const g = [1, 2].map((v) => f(v | 0)); const h = f; console.log(g, h(2));", /the Int32 contract on 'a' cannot be checked: 'f' is used as a value/],
  ["return", "function half(a: Int32): Int32 { return a / 2; } console.log(half(4));", /the value returned from 'half' \(Int32\) is not provably an int32/],
];

describe("contracts accepted", () => {
  for (const [name, source] of accepted)
    test(name, async () => {
      const r = await diagnose(source);
      expect(r.messages).toEqual([]);
      expect(r.ok).toBe(true);
    });
  test("proven slots reach IrModule.contracts", async () => {
    const r = await diagnose("class P { r: Uint8 = 0; n: Int32 = 0; } function f(a: Int32): Int32 { const t: Int16 = a & 0x7fff; return t; } const p = new P(); p.r = 7; console.log(f(3), p.r, p.n);");
    expect(r.ok).toBe(true);
    expect(r.contracts?.int32Fields).toEqual(expect.arrayContaining([expect.stringMatching(/P\0r$/), expect.stringMatching(/P\0n$/)]));
    expect(r.contracts?.narrowFields).toEqual([expect.stringMatching(/P\0r\0Uint8$/)]);
    expect(r.contracts?.int32Params).toEqual(expect.arrayContaining(["f\0a.0"]));
    expect(r.contracts?.int32Returns).toEqual(expect.arrayContaining(["f"]));
  });
});

describe("contracts refused (SC7002, SC7003)", () => {
  for (const [name, source, message] of refused)
    test(name, async () => {
      const r = await diagnose(source);
      expect(r.ok).toBe(false);
      expect(r.messages.join("\n")).toMatch(name === "function value" ? /^SC7003 / : /^SC7002 /);
      expect(r.messages.join("\n")).toMatch(message);
    });
});
