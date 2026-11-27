#!/usr/bin/env node
// Installs a packed tarball into a clean directory, then compiles each sample to WasmGC and runs it, against Node
// running the same source: stdout, stderr and the exit status must match.
//
//   node npm/wasmgc/test/smoke.mjs <package.tgz> [--keep]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tarball = process.argv[2] && path.resolve(process.argv[2]);
if (!tarball || !fs.existsSync(tarball)) { console.error("usage: smoke.mjs <package.tgz> [--keep]"); process.exit(2); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wasmgc-smoke-"));
const sh = (cmd, args, opts = {}) => {
  const t = performance.now();
  const r = spawnSync(cmd, args, { cwd: dir, encoding: "utf8", ...opts });
  return { ...r, ms: Math.round(performance.now() - t) };
};

let failures = 0;
try {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module" }) + "\n");
  const install = sh("npm", ["install", "--no-audit", "--no-fund", tarball]);
  if (install.status !== 0) { console.error(install.stdout, install.stderr); process.exit(1); }
  console.log(`install: ${install.ms} ms`);
  const bin = path.join(dir, "node_modules/.bin/wasmgc");

  for (const sample of fs.readdirSync(path.join(here, "samples")).filter((f) => f.endsWith(".ts")).sort()) {
    const src = path.join(dir, sample);
    fs.copyFileSync(path.join(here, "samples", sample), src);
    const oracle = sh(process.execPath, [src]);
    const run = sh(bin, ["run", src]);
    const same = run.stdout === oracle.stdout && run.stderr === oracle.stderr && run.status === oracle.status;
    console.log(`${same ? "ok  " : "FAIL"} run ${sample}: ${run.ms} ms (node ${oracle.ms} ms)`);
    if (!same) {
      failures++;
      console.log({ expected: { stdout: oracle.stdout, stderr: oracle.stderr, status: oracle.status }, got: { stdout: run.stdout, stderr: run.stderr, status: run.status } });
    }
    const wasm = src.replace(/\.ts$/, ".wasm");
    const build = sh(bin, ["build", src, "-o", wasm, "--target", "wasmgc"]);
    const again = sh(bin, ["run", wasm]);
    const built = build.status === 0 && again.stdout === oracle.stdout && again.stderr === oracle.stderr && again.status === oracle.status;
    console.log(`${built ? "ok  " : "FAIL"} build ${sample}: ${build.ms} ms, ${fs.existsSync(wasm) ? fs.statSync(wasm).size : 0} bytes; run .wasm ${again.ms} ms`);
    if (!built) { failures++; console.log(build.stderr, again.stderr); }
  }
} finally {
  if (process.argv.includes("--keep")) console.log(`kept ${dir}`);
  else fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
