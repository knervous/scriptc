import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { format, promisify } from "node:util";
import { afterAll, expect, test } from "vitest";
import { compile } from "../src/index.js";
import { instantiateWasmGc } from "../src/backend/wasmgc/host.js";

const execFileAsync = promisify(execFile);

// An installed (copied, not linked) package that names its TypeScript source as the `compiled` condition's entry and
// its JavaScript build as everyone else's, for the package itself and for its `#impl` import. Node runs the JavaScript;
// a compile with `conditions: ["compiled"]` compiles the source as program modules (a class included).
const project = realpathSync(mkdtempSync(join(tmpdir(), "scriptc-condition-source-")));
const files: Record<string, string> = {
  "package.json": JSON.stringify({ type: "module" }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "nodenext", target: "es2022", allowImportingTsExtensions: true, noEmit: true } }),
  "main.ts": [
    'import { Counter, describe } from "condsrc";',
    "const c = new Counter(2);",
    "c.add(3);",
    'console.log(describe({ value: "installed" }), c.total, c.label());',
    "",
  ].join("\n"),
  "node_modules/condsrc/package.json": JSON.stringify({
    name: "condsrc", version: "1.0.0", type: "module",
    exports: { ".": { compiled: "./src/index.ts", default: "./dist/index.js" } },
    imports: { "#impl": { compiled: "./src/impl.ts", default: "./dist/impl.js" } },
  }),
  "node_modules/condsrc/src/index.ts": [
    'import { prefix } from "#impl";',
    'export { Counter } from "./counter.ts";',
    "export function describe(v: { value: string }): string {",
    "  return `${prefix()}:${v.value}:${v.value.length}`;",
    "}",
    "",
  ].join("\n"),
  "node_modules/condsrc/src/counter.ts": [
    "export class Counter {",
    "  private readonly steps: number[] = [];",
    "  constructor(public total: number) {}",
    "  add(n: number): void { this.steps.push(n); this.total += n; }",
    "  label(): string { return `steps=${this.steps.length}`; }",
    "}",
    "",
  ].join("\n"),
  "node_modules/condsrc/src/impl.ts": 'export function prefix(): string { return "condsrc"; }\n',
  "node_modules/condsrc/dist/index.js": [
    'import { prefix } from "#impl";',
    'export { Counter } from "./counter.js";',
    "export function describe(v) { return `${prefix()}:${v.value}:${v.value.length}`; }",
    "",
  ].join("\n"),
  "node_modules/condsrc/dist/counter.js": [
    "export class Counter {",
    "  steps = [];",
    "  constructor(total) { this.total = total; }",
    "  add(n) { this.steps.push(n); this.total += n; }",
    "  label() { return `steps=${this.steps.length}`; }",
    "}",
    "",
  ].join("\n"),
  "node_modules/condsrc/dist/impl.js": 'export function prefix() { return "condsrc"; }\n',
};
for (const [file, text] of Object.entries(files)) {
  mkdirSync(dirname(join(project, file)), { recursive: true });
  writeFileSync(join(project, file), text);
}
const entry = join(project, "main.ts");

afterAll(() => rmSync(project, { recursive: true, force: true }));

test("an installed package's condition-selected TypeScript source compiles as program modules, as Node runs its JavaScript", async () => {
  const node = await execFileAsync(process.execPath, [entry], { encoding: "utf8", cwd: project });
  expect(node.stdout).toBe("condsrc:installed:9 5 steps=1\n");

  const outDir = join(project, "out");
  const outPath = join(outDir, "p.wasm");
  const r = await compile(entry, { outputKind: "wasmgc", outDir, outPath, conditions: ["compiled"] });
  expect(r.ok, r.ok ? "" : r.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n")).toBe(true);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const m = await instantiateWasmGc(readFileSync(outPath), {
    log: (...v: unknown[]) => stdout.push(format(...v) + "\n"),
    error: (...v: unknown[]) => stderr.push(format(...v) + "\n"),
  });
  await m.main();
  expect(stdout.join("")).toBe(node.stdout);
  expect(stderr.join("")).toBe(node.stderr);

  // Without the condition the package is npm surface (its JavaScript runs in the island), so a static build refuses it.
  const plain = await compile(entry, { outputKind: "wasmgc", outDir, outPath: join(outDir, "q.wasm") });
  expect(plain.ok).toBe(false);
}, 120_000);
