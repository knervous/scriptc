import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, expect, test } from "vitest";
import { compile } from "../src/index.js";

const execFileAsync = promisify(execFile);

// An installed CommonJS package whose entry picks its build from process.env.NODE_ENV, as React's does (a call before
// the production require included), and typed by an @types twin. Node with NODE_ENV=production loads the production file; a --npm-static compile
// with that `define` folds the entry's switch and compiles the same file into the module.
const project = realpathSync(mkdtempSync(join(tmpdir(), "scriptc-defined-branches-")));
const build = (mode: string) => [
  "'use strict';",
  `exports.mode = function () { return "${mode}"; };`,
  "exports.memo = function (type, compare) { return { kind: 'memo', type: type, compare: compare === undefined ? null : compare }; };",
  "exports.createElement = function (type, props) { return { type: type, props: props }; };",
  "exports.internals = { renders: 0 };",
  `exports.version = "${mode}-19";`,
  "",
].join("\n");
const files: Record<string, string> = {
  "package.json": JSON.stringify({ type: "module" }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "nodenext", target: "es2022", noEmit: true, allowJs: true } }),
  "main.ts": [
    'import { mode, memo, createElement } from "envswitch";',
    'import { render } from "envswitch-dom";',
    "const m = memo(\"Row\");",
    'const el = createElement("div", { className: "a", id: 7 });',
    "console.log(mode(), m.kind, m.type, m.compare, el.type, el.props.className, el.props.id);",
    "console.log(render(), render());",
    "",
  ].join("\n"),
  "node_modules/envswitch/package.json": JSON.stringify({ name: "envswitch", version: "1.0.0", main: "index.js" }),
  "node_modules/envswitch/index.js": [
    "'use strict';",
    "",
    "function check() {",
    "  if (typeof globalThis.__never_defined__ === 'undefined') return;",
    "  throw new Error('unreachable');",
    "}",
    "",
    "if (process.env.NODE_ENV === 'production') {",
    "  // checked first, as React DOM's entry does",
    "  check();",
    "  module.exports = require('./cjs/envswitch.production.js');",
    "} else {",
    "  module.exports = require('./cjs/envswitch.development.js');",
    "}",
    "",
  ].join("\n"),
  // Typed by a DefinitelyTyped-style twin, as React is by @types/react.
  "node_modules/@types/envswitch/package.json": JSON.stringify({ name: "@types/envswitch", version: "1.0.0", types: "index.d.ts" }),
  "node_modules/@types/envswitch/index.d.ts": [
    "export function mode(): string;",
    "export function memo<T>(type: T, compare?: (a: unknown, b: unknown) => boolean): { kind: string; type: T; compare: ((a: unknown, b: unknown) => boolean) | null };",
    "export function createElement<P extends object>(type: string, props: P): { type: string; props: P };",
    "",
  ].join("\n"),
  // A second package requiring the first by name and reading its members, as React DOM reads React's internals.
  "node_modules/envswitch-dom/package.json": JSON.stringify({ name: "envswitch-dom", version: "1.0.0", main: "index.js" }),
  "node_modules/envswitch-dom/index.js": [
    "'use strict';",
    "var Lib = require('envswitch');",
    "var internals = Lib.internals;",
    "exports.render = function () { internals.renders++; return Lib.version + '#' + internals.renders; };",
    "",
  ].join("\n"),
  "node_modules/@types/envswitch-dom/package.json": JSON.stringify({ name: "@types/envswitch-dom", version: "1.0.0", types: "index.d.ts" }),
  "node_modules/@types/envswitch-dom/index.d.ts": "export function render(): string;\n",
  "node_modules/envswitch/cjs/envswitch.production.js": build("production"),
  "node_modules/envswitch/cjs/envswitch.development.js": build("development"),
};
for (const [file, text] of Object.entries(files)) {
  mkdirSync(dirname(join(project, file)), { recursive: true });
  writeFileSync(join(project, file), text);
}
const entry = join(project, "main.ts");

afterAll(() => rmSync(project, { recursive: true, force: true }));

test("--npm-static follows a NODE_ENV-switched CommonJS entry to the build its define selects, as Node does", async () => {
  const node = await execFileAsync(process.execPath, [entry], { encoding: "utf8", cwd: project, env: { ...process.env, NODE_ENV: "production" } });
  expect(node.stdout).toBe("production memo Row null div a 7\nproduction-19#1 production-19#2\n");

  const outDir = join(project, "out");
  const outPath = join(outDir, "p.wasm");
  const r = await compile(entry, {
    // (the browser target, as a React app builds: the package's untyped JavaScript values are native dynamic values)
    outputKind: "wasmgc", outDir, outPath, browser: true, dynModel: "native",
    npmStatic: ["envswitch", "envswitch-dom"], define: { "process.env.NODE_ENV": '"production"' },
  });
  expect(r.ok, r.ok ? "" : r.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n")).toBe(true);
  // Run as the browser fixtures run in Node (tests/wasmgc-browser/run-wasm.mjs): console output is the process's.
  const runner = fileURLToPath(new URL("../../../tests/wasmgc-browser/run-wasm.mjs", import.meta.url));
  const wasm = await execFileAsync(process.execPath, [runner, outPath], { encoding: "utf8", cwd: project });
  expect(wasm.stdout).toBe(node.stdout);
  expect(wasm.stderr).toBe(node.stderr);
}, 120_000);
