import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile } from "../../index.js";

const SOURCE = [
  "class Counter {",
  "  n = 0;",
  "  bump(by: number): number {",
  "    this.n += by;", // line 4
  "    return this.n;",
  "  }",
  "}",
  "function total(xs: number[]): number {",
  "  const c = new Counter();",
  "  for (const x of xs) c.bump(x);", // line 10
  "  return c.n;",
  "}",
  // A runtime input, so -O2 cannot fold the whole program into a constant.
  "console.log(total(Array.from({ length: 3 + (Date.now() % 2) }, (_, i) => i)));", // line 13
].join("\n") + "\n";

/** The module's sections as (id, custom name, byte range); enough to find and drop the sourceMappingURL section. */
function sections(bytes: Uint8Array): { id: number; name: string | null; start: number; end: number }[] {
  const out: { id: number; name: string | null; start: number; end: number }[] = [];
  let at = 8;
  const leb = (): number => { let r = 0, shift = 0, b = 0; do { b = bytes[at++]!; r |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80); return r >>> 0; };
  while (at < bytes.length) {
    const start = at, id = bytes[at++]!, size = leb(), body = at;
    let name: string | null = null;
    if (id === 0) { const len = leb(); name = new TextDecoder().decode(bytes.subarray(at, at + len)); }
    out.push({ id, name, start, end: body + size });
    at = body + size;
  }
  return out;
}
function customText(bytes: Uint8Array, name: string): string | null {
  const s = sections(bytes).find((x) => x.name === name);
  if (!s) return null;
  // The payload after the section name: a length-prefixed string.
  const payload = bytes.subarray(s.start, s.end);
  const text = new TextDecoder().decode(payload);
  return text.slice(text.indexOf(name) + name.length + 1);
}
function withoutSection(bytes: Uint8Array, name: string): Uint8Array {
  const parts = sections(bytes).filter((x) => x.name !== name);
  const out: number[] = [...bytes.subarray(0, 8)];
  for (const p of parts) out.push(...bytes.subarray(p.start, p.end));
  return new Uint8Array(out);
}

/** Source map v3 mappings: each segment's [generated column (the wasm offset), source, line, column], 0-based. */
function decodeMappings(mappings: string): number[][] {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const segments: number[][] = [];
  const state = [0, 0, 0, 0];
  for (const line of mappings.split(";")) {
    state[0] = 0;
    for (const seg of line.split(",")) {
      if (!seg) continue;
      const fields: number[] = [];
      let value = 0, shift = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch);
        value += (d & 31) << shift;
        if (d & 32) { shift += 5; continue; }
        fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0; shift = 0;
      }
      fields.forEach((f, i) => { if (i < 4) state[i]! += f; });
      if (fields.length >= 4) segments.push([state[0]!, state[1]!, state[2]!, state[3]!]);
    }
  }
  return segments;
}

async function build(dir: string, name: string, release: boolean, sourceMap: boolean): Promise<Uint8Array> {
  const out = join(dir, `${name}.wasm`);
  const r = await compile(join(dir, "main.ts"), {
    outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native",
    ...(release ? { release: true } : { optimization: "dev" as const }),
    ...(sourceMap ? { sourceMap: true, sourceMapUrl: `http://localhost:5173/${name}.wasm.map` } : {}),
  });
  expect(r.ok ? [] : r.diagnostics.map((d) => d.message)).toEqual([]);
  return new Uint8Array(readFileSync(out));
}

for (const release of [false, true]) {
  test(`a ${release ? "release" : "dev"} build's source map maps statements to their lines and leaves the code unchanged`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "source-map-test-"));
    writeFileSync(join(dir, "main.ts"), SOURCE);
    const plain = await build(dir, "plain", release, false);
    const mapped = await build(dir, "mapped", release, true);
    // The URL rides in the sourceMappingURL section; without it the module is the unmapped one, byte for byte.
    expect(customText(mapped, "sourceMappingURL")).toBe("http://localhost:5173/mapped.wasm.map");
    expect(customText(plain, "sourceMappingURL")).toBeNull();
    expect(Buffer.from(withoutSection(mapped, "sourceMappingURL")).equals(Buffer.from(plain))).toBe(true);
    const map = JSON.parse(readFileSync(join(dir, "mapped.wasm.map"), "utf8")) as { version: number; sources: string[]; mappings: string };
    expect(map.version).toBe(3);
    const main = map.sources.findIndex((s) => s.endsWith("main.ts"));
    expect(main).toBeGreaterThanOrEqual(0);
    const segments = decodeMappings(map.mappings);
    const lines = new Set(segments.filter((s) => s[1] === main).map((s) => s[2]! + 1));
    // Dev: the loop body's call, the method's compound assignment and the top-level log each keep a location. Release:
    // wasm-opt drops locations as it rewrites (on this program -O1 keeps 12 of the 38, -O2 2: inlining folds it into one
    // function), so only the surviving log is required.
    expect(lines.has(13)).toBe(true);
    if (!release) for (const line of [4, 10]) expect(lines.has(line)).toBe(true);
    // Every offset lands inside the module (the code section, in fact).
    const code = sections(mapped).find((s) => s.id === 10)!;
    for (const s of segments) expect(s[0]! >= code.start && s[0]! < code.end).toBe(true);
  }, 240000);
}

test("a release large enough to stage (two wasm-opt processes) still carries its map", async () => {
  const dir = mkdtempSync(join(tmpdir(), "source-map-staged-"));
  writeFileSync(join(dir, "main.ts"), SOURCE);
  const was = process.env["SCRIPTC_WASMOPT_STAGED"];
  process.env["SCRIPTC_WASMOPT_STAGED"] = "0";
  try {
    const mapped = await build(dir, "staged", true, true);
    expect(customText(mapped, "sourceMappingURL")).toBe("http://localhost:5173/staged.wasm.map");
    const map = JSON.parse(readFileSync(join(dir, "staged.wasm.map"), "utf8")) as { mappings: string; sources: string[] };
    const main = map.sources.findIndex((s) => s.endsWith("main.ts"));
    expect(decodeMappings(map.mappings).some((s) => s[1] === main && s[2] === 12)).toBe(true);
  } finally { if (was === undefined) delete process.env["SCRIPTC_WASMOPT_STAGED"]; else process.env["SCRIPTC_WASMOPT_STAGED"] = was; }
}, 240000);
