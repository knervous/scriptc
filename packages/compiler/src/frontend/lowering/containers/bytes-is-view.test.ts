import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, deserializeModule, validateModule } from "../../../index.js";
import type { IrModule } from "../../../ir/ir.js";

async function lower(source: string): Promise<IrModule> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-bytes-is-view-"));
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

/** Every node of a function's body, by kind (and a libCall by its fn). */
function nodes(module: IrModule, name: string): string[] {
  const fn = module.functions.find((f) => f.name === name || f.name.endsWith(`.${name}`));
  if (!fn) throw new Error(`no function ${name}`);
  const found: string[] = [];
  JSON.stringify(fn.body, (_key, value: unknown) => {
    const node = value as { kind?: string; fn?: string };
    if (typeof node?.kind === "string") found.push(node.kind === "libCall" ? `libCall:${node.fn}` : node.kind);
    return value;
  });
  return found;
}

const SOURCE = `
class GpuBuffer {
  readonly size: number;
  constructor(size: number) { this.size = size; }
}
export function upload(data: GpuBuffer | ArrayBufferView | null): string {
  if (data && ArrayBuffer.isView(data)) return "view " + data.byteLength;
  return data ? "buffer " + data.size : "none";
}
export function plain(data: Float32Array): boolean {
  return ArrayBuffer.isView(data);
}
console.log(upload(new Float32Array(2)), upload(new GpuBuffer(4)), upload(null), plain(new Float32Array(1)));
`;

// shader-vb.ts setMeshVertexBuffer: a Float32Array in a GPUBuffer | ArrayBufferView union went through the union's
// dyn conversion, which hands the f32 and u8c arms over as host views; a native host saw no compiled view, answered
// false, and the else branch cast the view to the buffer arm (a trap every frame).
test("isView on a union decides its typed-array arms by tag", async () => {
  const kinds = nodes(await lower(SOURCE), "upload");
  expect(kinds).toContain("unionIsTag");
  expect(kinds).toContain("ternary");
});

test("isView on a typed-array type needs no runtime test", async () => {
  const kinds = nodes(await lower(SOURCE), "plain");
  expect(kinds).not.toContain("libCall:arrayBuffer.isView");
});
