import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, deserializeModule, validateModule } from "../../index.js";
import type { IrModule } from "../../ir/ir.js";

async function lower(source: string): Promise<IrModule> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-dom-list-"));
  try {
    const entry = join(dir, "main.ts"),
      output = join(dir, "main.ir.json");
    await writeFile(entry, source);
    const result = await compile(entry, { outDir: dir, outPath: output, outputKind: "ir", browser: true, dynModel: "native" });
    if (!result.ok)
      throw new Error(result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"));
    const module = deserializeModule(await readFile(output, "utf8"));
    expect(validateModule(module)).toEqual([]);
    return module;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The jsOp names and libCall fns in a function's body. */
function ops(module: IrModule, name: string): string[] {
  const fn = module.functions.find((f) => f.name === name || f.name.endsWith(`.${name}`));
  if (!fn) throw new Error(`no function ${name}`);
  const found: string[] = [];
  JSON.stringify(fn.body, (_key, value: unknown) => {
    const node = value as { kind?: string; op?: string; fn?: string; callee?: string };
    if (node?.kind === "jsOp") found.push(`jsOp:${node.op}`);
    if (node?.kind === "call") found.push(`call:${node.callee}`);
    if (node?.kind === "libCall") found.push(`libCall:${node.fn}`);
    return value;
  });
  return found;
}

const SOURCE = `
export function texts(root: HTMLElement): string {
  const out: string[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(".item")) out.push(element.textContent ?? "");
  return out.join(",");
}
export function spread(root: HTMLElement): number {
  return [...root.querySelectorAll<HTMLElement>(".item")].length;
}
export function any(list: Iterable<unknown>): number {
  let n = 0;
  for (const _ of list) n++;
  return n;
}
const root = document.body;
console.log(texts(root), spread(root), any([1, 2]));
`;

// A layout module's for-of over querySelectorAll reached js.iterator, which a native host (static node lists answering
// length and index reads) does not speak.
test("for-of over a DOM indexed collection iterates by length and index", async () => {
  const found = ops(await lower(SOURCE), "texts");
  expect(found).toContain("jsOp:getIdx");
  expect(found).not.toContain("jsOp:iterNew");
});

test("spread of a DOM indexed collection copies by length and index", async () => {
  const module = await lower(SOURCE);
  expect(ops(module, "spread")).toContain("call:%dom.collectionArray");
  const copy = ops(module, "%dom.collectionArray");
  expect(copy).toContain("jsOp:getIdx");
  expect(copy).not.toContain("jsOp:iterNew");
});
