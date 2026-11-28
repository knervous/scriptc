import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// @ts-expect-error: a plain ES module without declarations
import { generateJs, generateTs, layout } from "../src/gen.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = {
  name: "demo",
  channel: 7,
  stream: "../src/stream",
  commands: [
    { op: 16, name: "move", args: [{ name: "node", type: "handle" }, { name: "x", type: "f64" }, { name: "visible", type: "bool" }] },
    { op: 17, name: "label", args: [{ name: "node", type: "handle" }, { name: "key", type: "atom" }, { name: "text", type: "str" }] },
  ],
  records: [
    { name: "pointer", fields: [{ name: "id", type: "i32" }, { name: "x", type: "f64" }, { name: "down", type: "bool" }, { name: "y", type: "f64" }] },
  ],
};

describe("layout", () => {
  test("f64 fields are 8-byte aligned and records end on an even word", () => {
    const l = layout(schema);
    expect(l.records[0].fields.map((f: { name: string; at: number }) => [f.name, f.at])).toEqual([["id", 0], ["x", 2], ["down", 4], ["y", 6]]);
    expect(l.recordWords).toBe(8);
  });
  test("ops below 16 are the stream's own, and an op is used once", () => {
    expect(() => layout({ ...schema, commands: [{ op: 1, name: "x", args: [] }] })).toThrow(/16 and up/);
    expect(() => layout({ ...schema, commands: [schema.commands[0], { ...schema.commands[1], op: 16 }] })).toThrow(/taken/);
    expect(() => layout({ ...schema, commands: [{ op: 20, name: "x", args: [{ name: "a", type: "object" }] }] })).toThrow(/type object/);
  });
});

describe("generated code", () => {
  test("the encoder writes [op, n, args] with strings as offset and length, and f64 as two words", () => {
    const ts = generateTs(schema);
    expect(ts).toContain("const at = this.reserve(6);");
    expect(ts).toContain("w[at] = 16;\n    w[at + 1] = 4;");
    expect(ts).toContain("this.f64(at + 3, x);");
    expect(ts).toContain("w[at + 5] = visible ? 1 : 0;");
    expect(ts).toContain("w[at + 4] = this.str(text);\n    w[at + 5] = text.length;");
    expect(ts).toContain("pointerY(): number {\n    return this.recordF64(6);");
  });
  test("the replay decodes what the encoder writes", async () => {
    const js = generateJs(schema);
    const mod = await import(`data:text/javascript,${encodeURIComponent(js)}`);
    const words = new Int32Array(32);
    const f = new Float64Array(1), fw = new Int32Array(f.buffer);
    f[0] = 2.5;
    const text = "titlehello";
    // ATOM 1 = "title"; move(3, 2.5, true); label(3, atom 1, "hello")
    words.set([1, 3, 1, 0, 5, 16, 4, 3, fw[0]!, fw[1]!, 1, 17, 4, 3, 1, 5, 5]);
    const calls: unknown[] = [];
    const atoms = [""];
    const n = mod.replayDemo(words, 0, 17, text, atoms, {
      move: (...a: unknown[]) => calls.push(["move", ...a]),
      label: (...a: unknown[]) => calls.push(["label", ...a]),
    });
    expect(n).toBe(3);
    expect(atoms[1]).toBe("title");
    expect(calls).toEqual([["move", 3, 2.5, true], ["label", 3, "title", "hello"]]);
    const floats = new Float64Array(8), ints = new Int32Array(floats.buffer);
    mod.setPointerY(ints, floats, 0, 7.25);
    mod.setPointerDown(ints, floats, 0, true);
    expect(floats[3]).toBe(7.25);
    expect(ints[4]).toBe(1);
  });
  test("a handles argument is a count and that many words, and reaches the handler as words, start and count", async () => {
    const withList = { ...schema, commands: [...schema.commands, { op: 18, name: "group", args: [{ name: "id", type: "i32" }, { name: "nodes", type: "handles" }] }] };
    const ts = generateTs(withList);
    expect(ts).toContain("group(id: number, nodes: number[], nodesCount: number): void {");
    expect(ts).toContain("const at = this.reserve(4 + nodesCount);");
    expect(ts).toContain("w[at + 1] = 2 + nodesCount;");
    expect(ts).toContain("for (let i = 0; i < nodesCount; i++) w[at + 4 + i] = nodes[i]!;");
    const mod = await import(`data:text/javascript,${encodeURIComponent(generateJs(withList))}`);
    // group(5, [7, 8, 9]), then move(3, 0, false)
    const words = new Int32Array([18, 5, 5, 3, 7, 8, 9, 16, 4, 3, 0, 0, 0]);
    const calls: unknown[] = [];
    mod.replayDemo(words, 0, 13, "", [""], {
      group: (id: number, w: Int32Array, start: number, count: number) => calls.push(["group", id, [...w.subarray(start, start + count)]]),
      move: (...a: unknown[]) => calls.push(["move", ...a]),
    });
    expect(calls).toEqual([["group", 5, [7, 8, 9]], ["move", 3, 0, false]]);
    expect(() => layout({ ...schema, commands: [{ op: 20, name: "x", args: [{ name: "a", type: "handles" }, { name: "b", type: "i32" }] }] })).toThrow(/last argument/);
  });
  test("an unknown command reaches the handlers' `unknown`, and fails without it", async () => {
    const mod = await import(`data:text/javascript,${encodeURIComponent(generateJs(schema))}`);
    const words = new Int32Array([99, 1, 0]);
    const seen: number[] = [];
    mod.replayDemo(words, 0, 3, "", [""], { unknown: (op: number) => seen.push(op) });
    expect(seen).toEqual([99]);
    expect(() => mod.replayDemo(words, 0, 3, "", [""], {})).toThrow(/unknown command 99/);
  });
});

test("the DOM stream's generated files are current", () => {
  const dir = join(here, "../../dom-stream");
  const dom = { ...JSON.parse(readFileSync(join(dir, "dom.schema.json"), "utf8")), source: "dom.schema.json" };
  expect(readFileSync(join(dir, "src/dom-stream.generated.ts"), "utf8")).toBe(generateTs(dom));
  expect(readFileSync(join(dir, "src/dom-stream.generated.js"), "utf8")).toBe(generateJs(dom));
});
