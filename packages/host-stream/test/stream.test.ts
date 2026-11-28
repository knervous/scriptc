import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { compile } from "../../compiler/src/index.js";
// @ts-expect-error: a plain ES module without declarations
import { generateJs, generateTs } from "../src/gen.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../src");

// A compiled program writes a generated stream (commands, strings, atoms, an f64, a flush when the arena is full) and reads a
// record the host wrote; the host replays every flush in order.
test("a compiled stream's flushes replay on the host in order, and its records read back in place", async () => {
  const dir = mkdtempSync(join(tmpdir(), "host-stream-test-"));
  try {
    const schema = {
      name: "demo", channel: 7, stream: join(src, "stream"),
      commands: [
        { op: 16, name: "move", args: [{ name: "node", type: "handle" }, { name: "x", type: "f64" }, { name: "visible", type: "bool" }] },
        { op: 17, name: "label", args: [{ name: "node", type: "handle" }, { name: "key", type: "atom" }, { name: "text", type: "str" }] },
      ],
      records: [{ name: "pointer", fields: [{ name: "id", type: "i32" }, { name: "y", type: "f64" }] }],
    };
    writeFileSync(join(dir, "demo.generated.ts"), generateTs(schema));
    writeFileSync(join(dir, "demo.generated.js"), generateJs(schema));
    writeFileSync(join(dir, "main.ts"), [
      'import { DemoStream } from "./demo.generated";',
      // 24 command words: room for three or four commands, so 20 of them flush mid-run.
      "const s = new DemoStream(24);",
      "export function run(n: number): number {",
      "  for (let i = 0; i < n; i++) {",
      '    s.label(i, s.atom(i % 2 === 0 ? "even" : "odd"), "t" + i + "\\u00e9");',
      "    s.move(i, i * 0.5, i % 3 === 0);",
      "  }",
      "  s.flush();",
      "  return s.pointerId() * 1000 + s.pointerY();",
      "}", ""].join("\n"));
    const out = join(dir, "main.wasm");
    const r = await compile(join(dir, "main.ts"), { outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native", strictHostModules: true, wasmLink: { exports: ["run"] } });
    expect(r.ok, JSON.stringify(r.ok ? null : r.diagnostics)).toBe(true);
    const runner = join(dir, "run.mjs");
    writeFileSync(runner, [
      `import { readFileSync } from "node:fs";`,
      `import { instantiateLinked } from ${JSON.stringify(pathToFileURL(join(here, "../../compiler/src/backend/wasmgc/host.ts")).href)};`,
      `import { createHostStreams } from ${JSON.stringify(pathToFileURL(join(src, "host.js")).href)};`,
      `import { replayDemo, setPointerId, setPointerY } from ${JSON.stringify(pathToFileURL(join(dir, "demo.generated.js")).href)};`,
      `let memory;`,
      `const streams = createHostStreams(() => memory);`,
      `const seen = [];`,
      `streams.consume(7, (ch) => {`,
      `  ch.replay = replayDemo;`,
      `  ch.handlers = { move: (n, x, v) => seen.push(["move", n, x, v]), label: (n, k, t) => seen.push(["label", n, k, t]) };`,
      `  setPointerId(ch.words, ch.floats, ch.recordBase, 4);`,
      `  setPointerY(ch.words, ch.floats, ch.recordBase, 0.25);`,
      `});`,
      `const linked = await instantiateLinked(readFileSync(${JSON.stringify(out)}), { "": {} }, streams.imports);`,
      `memory = linked.instance.exports.memory;`,
      `await linked.modules[""].main();`,
      `const value = linked.modules[""].exports.run(25);`,
      `const ch = streams.channels.get(7);`,
      `console.log(JSON.stringify({ value, flushes: ch.flushes, commands: ch.commands, seen }));`,
    ].join("\n"));
    const text = execFileSync(process.execPath, ["--experimental-wasm-rab-integration", "--import", "tsx", runner], { encoding: "utf8", cwd: join(here, "../../..") });
    const got = JSON.parse(text.trim().split("\n").pop()!);
    expect(got.value).toBe(4000.25);
    expect(got.flushes).toBeGreaterThan(10);
    // Every command, the two atom definitions included, in program order.
    expect(got.commands).toBe(52);
    const expected: unknown[] = [];
    for (let i = 0; i < 25; i++) {
      expected.push(["label", i, i % 2 === 0 ? "even" : "odd", `t${i}é`]);
      expected.push(["move", i, i * 0.5, i % 3 === 0]);
    }
    expect(got.seen).toEqual(expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 240000);
