import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, deserializeModule, validateModule } from "../../../index.js";
import type { IrModule } from "../../../ir/ir.js";

async function lower(source: string): Promise<IrModule> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-bytes-new-union-"));
  try {
    const entry = join(dir, "main.ts"),
      output = join(dir, "main.ir.json");
    await writeFile(entry, source);
    const result = await compile(entry, { outDir: dir, outPath: output, outputKind: "ir" });
    if (!result.ok)
      throw new Error(result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"));
    const module = deserializeModule(await readFile(output, "utf8"));
    expect(validateModule(module)).toEqual([]);
    return module;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The source kinds of every bytesNew in a function's body. */
function bytesNewSources(module: IrModule, name: string): string[] {
  const fn = module.functions.find((f) => f.name === name || f.name.endsWith(`.${name}`));
  if (!fn) throw new Error(`no function ${name}`);
  const found: string[] = [];
  JSON.stringify(fn.body, (_key, value: unknown) => {
    const node = value as { kind?: string; source?: { kind?: string; type?: { kind?: string } } | null };
    if (node?.kind === "bytesNew") found.push(node.source ? `${node.source.kind}:${node.source.type?.kind}` : "empty");
    return value;
  });
  return found;
}

// gltf-ext-basisu.ts preMesh: the union went to dyn, typed-array arms crossed as page views, and a native host
// could not iterate them (js.arrayFromIterator).
test("new TypedArray over a union constructs from each arm's own type", async () => {
  const module = await lower(`
export function widen(data: Uint16Array | Uint32Array | Uint8Array): Uint32Array {
  return new Uint32Array(data);
}
console.log(widen(new Uint16Array([1, 2])).length, widen(new Uint8Array(3)).length);
`);
  const sources = bytesNewSources(module, "widen");
  expect(sources).toContain("unionNarrow:bytes");
  expect(sources.some((s) => s.endsWith(":dyn"))).toBe(false);
});
