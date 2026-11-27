#!/usr/bin/env node
// Experimental: prepares a tsc-ts checkout for a WasmGC build of its `--api` server, the checker the compiler's
// frontend talks to. The WasmGC build starts no threads, so the edits cut tsc-ts's thread machinery without changing
// what a single-threaded run does:
//
// - src/wasm-api.ts, the entry: the API server alone, without the thread drivers of src/main.ts;
// - src/wasm/threads.ts stands in for `@scriptc/threads` (nothing is published; graphs are never shared, as under
//   Node.js), and every import of the package points at it;
// - `SharedArrayBuffer` is `ArrayBuffer` (one thread: nothing to share);
// - parallel-parse.ts's workers are typed by the two methods it calls, not by `node:worker_threads`;
// - the API server's resident-memory probe answers 0, its documented "cannot be read" value;
// - find-references.ts's reference test takes `FileReference`, the element type of the arrays it is applied to (the
//   compiler cannot yet adapt a callback with a structural parameter to class elements).
//
//   node npm/wasmgc/tsc-ts/prepare.mjs <tsc-ts checkout at v0.1.5>
//
// Then compile it: node npm/wasmgc/tsc-ts/compile.mjs <checkout> <out.wasm>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const VERSION = "0.1.5";
const COMMIT = "04f804ff133a832c1aa7b30c625869ab2566c73d";

const checkout = process.argv[2] && path.resolve(process.argv[2]);
if (!checkout) { console.error("usage: prepare.mjs <tsc-ts checkout>"); process.exit(2); }
const head = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== COMMIT) { console.error(`prepare: ${checkout} is at ${head}, not tsc-ts v${VERSION} (${COMMIT})`); process.exit(1); }
const src = path.join(checkout, "packages/tsc-ts/src");

const edit = (file, from, to) => {
  const full = path.join(src, file);
  const text = fs.readFileSync(full, "utf8");
  if (!text.includes(from)) { console.error(`prepare: ${file}: expected text not found: ${from.slice(0, 60)}`); process.exit(1); }
  fs.writeFileSync(full, text.replace(from, to));
};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []);

fs.writeFileSync(path.join(src, "wasm-api.ts"), `// \`tsc-ts --api\` alone, for a WasmGC build: the API server without the thread drivers.
import { runServer } from './api/server.js';

const libraryPath = process.env.TSC_TS_LIB_DIR ?? '.';
process.exitCode = runServer(process.argv.slice(2), libraryPath);
`);
fs.mkdirSync(path.join(src, "wasm"), { recursive: true });
fs.writeFileSync(path.join(src, "wasm/threads.ts"), `// \`@scriptc/threads\` for the WasmGC build of the API server, which starts no threads: nothing is published, and graphs
// are never shared (as under Node.js).
export const sharesPublishedGraphs = false;

export function publish<T>(value: T): T {
  throw new TypeError('publish: the WasmGC build starts no threads');
}
`);

let files = 0;
for (const file of walk(src)) {
  let text = fs.readFileSync(file, "utf8");
  const before = text;
  const shim = path.relative(path.dirname(file), path.join(src, "wasm/threads.js")).split(path.sep).join("/");
  text = text.replaceAll("from '@scriptc/threads'", `from '${shim.startsWith(".") ? shim : `./${shim}`}'`);
  text = text.replace(/\bSharedArrayBuffer\b/g, "ArrayBuffer");
  if (text !== before) { fs.writeFileSync(file, text); files++; }
}
edit("compiler/parallel-parse.ts", "import type { Worker } from 'node:worker_threads';\n", `/** The worker a parse thread runs in, as this module uses it. The WasmGC build starts no threads. */
interface Worker {
  on(event: string, listener: (value: unknown) => void): void;
  postMessage(value: unknown): void;
}
`);
edit("api/server.ts", "    return process.memoryUsage.rss();\n", "    // The WasmGC build cannot read its resident memory.\n    return 0;\n");
edit("services/find-references.ts", "const inReference = (r: { pos: number; end: number }): boolean =>", "const inReference = (r: FileReference): boolean =>");
edit("services/find-references.ts", "import {", "import type { FileReference } from '../compiler/ast.js';\nimport {");
console.log(`prepare: tsc-ts v${VERSION} ready for a WasmGC build (${files} files rewritten, 4 edits)`);
