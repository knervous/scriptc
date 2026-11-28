/* An --npm-static package function typed by an @types twin, compiled for the
 * plain WasmGC lane (outputKind "wasmgc" without `browser`), run in-process
 * and compared with Node. The package's object results are untyped
 * JavaScript values the typed declaration describes. */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { format } from "node:util";
import { afterAll, expect, test } from "vitest";
import { compile } from "../src/index.js";
import { instantiateWasmGc } from "../src/backend/wasmgc/host.js";

const execFileAsync = promisify(execFile);
const root = realpathSync(mkdtempSync(join(tmpdir(), "scriptc-npm-static-plain-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const main = [
  'import { createElement } from "envswitch";',
  'const el = createElement("div", { className: "a", id: 7 });',
  "console.log(el.type, el.props.className, el.props.id);",
  "",
].join("\n");

/** A project whose envswitch package is typed by `declaration`. */
function project(name: string, declaration: string): string {
  const dir = join(root, name);
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "nodenext", target: "es2022", noEmit: true } }),
    "main.ts": main,
    "node_modules/envswitch/package.json": JSON.stringify({ name: "envswitch", version: "1.0.0", main: "index.js" }),
    "node_modules/envswitch/index.js": "'use strict';\nexports.createElement = function (type, props) { return { type: type, props: props }; };\n",
    "node_modules/@types/envswitch/package.json": JSON.stringify({ name: "@types/envswitch", version: "1.0.0", types: "index.d.ts" }),
    "node_modules/@types/envswitch/index.d.ts": declaration,
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return join(dir, "main.ts");
}

async function runPlain(entry: string): Promise<{ stdout: string; stderr: string }> {
  const outDir = join(dirname(entry), "out");
  const outPath = join(outDir, "p.wasm");
  const r = await compile(entry, { outputKind: "wasmgc", outDir, outPath, npmStatic: ["envswitch"] });
  expect(r.ok, r.ok ? "" : r.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n")).toBe(true);
  const stdout: string[] = [];
  const stderr: string[] = [];
  let uncaught: unknown = null;
  const m = await instantiateWasmGc(readFileSync(outPath), {
    log: (...v: unknown[]) => stdout.push(format(...v) + "\n"),
    error: (...v: unknown[]) => stderr.push(format(...v) + "\n"),
    onUncaught: (e: unknown) => { uncaught = e; },
  });
  await m.main();
  m.stopTimers();
  expect(uncaught).toBe(null);
  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

for (const [name, declaration] of [
  ["generic", "export function createElement<P extends object>(type: string, props: P): { type: string; props: P };\n"],
  ["non-generic", "export function createElement(type: string, props: { className: string; id: number }): { type: string; props: { className: string; id: number } };\n"],
] as const) {
  test(`a ${name} @types declaration reads the package's object result as Node does`, async () => {
    const entry = project(name, declaration);
    const node = await execFileAsync(process.execPath, [entry], { encoding: "utf8", cwd: dirname(entry) });
    expect(node.stdout).toBe("div a 7\n");
    const mine = await runPlain(entry);
    expect(mine.stdout).toBe(node.stdout);
    expect(mine.stderr).toBe(node.stderr);
  }, 120_000);
}
