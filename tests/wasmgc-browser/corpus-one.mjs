// One corpus program under the browser profile: compile, run, and diff against Node.
//   node corpus-one.mjs <corpus file> [--dyn native|engine]
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wasmNodeArgs } from "./node-flags.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, "../corpus", process.argv[2]);
const dyn = process.argv.includes("--dyn") ? process.argv[process.argv.indexOf("--dyn") + 1] : "native";
const { compile } = await import(path.resolve(here, "../../packages/compiler/dist/index.js"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-one-")), out = path.join(dir, "p.wasm");
const r = await compile(file, { outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: dyn, optimization: "dev" });
if (!r.ok) { console.log("REFUSED\n" + r.diagnostics.map((d) => d.message).join("\n")); process.exit(0); }
const run = (args) => spawnSync(process.execPath, args, { cwd: path.dirname(file), encoding: "utf8", timeout: 30000 });
// (the compiled run takes the flag Node 24 and 25 need for toResizableBuffer: node-flags.mjs)
const mine = run([...wasmNodeArgs, path.join(here, "run-wasm.mjs"), out]), oracle = run([file]);
const a = mine.stdout.split("\n"), b = oracle.stdout.split("\n");
console.log(`exit got ${mine.status} want ${oracle.status}`);
for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) console.log(`line ${i + 1}\n  got  ${JSON.stringify(a[i])}\n  want ${JSON.stringify(b[i])}`);
if (mine.stderr.trim()) console.log("stderr:\n" + mine.stderr.split("\n").filter((l) => !/^\s+at /.test(l)).slice(0, 6).join("\n"));
fs.rmSync(dir, { recursive: true, force: true });
