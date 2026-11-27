// Shared build provenance for gate and benchmark receipts: which compiler
// source and build produced a result, and which optimizer it used.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const forkRoot = path.resolve(here, "..");
export const compilerDir = path.join(forkRoot, "packages/compiler");
export const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const git = (cmd) => { try { return execSync(`git ${cmd}`, { cwd: forkRoot, encoding: "utf8" }).trim(); } catch { return ""; } };

/** Hash of every file under `dir` (relative paths and contents), recursively. */
export function treeHash(dir, filter = () => true) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (filter(p)) out.push(path.relative(dir, p) + ":" + sha(fs.readFileSync(p)));
  } };
  walk(dir);
  return sha(out.join("\n"));
}

/** Source files whose compiled output is missing or older than the source:
 * a run would use the previous build while srcTree/srcDiff describe the
 * edited source. tsc rewrites only changed outputs, so an unchanged file
 * merely touched by a checkout can also appear here; rebuilding clears it. */
export function staleDist() {
  const src = path.join(compilerDir, "src"), dist = path.join(compilerDir, "dist"), stale = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!p.endsWith(".ts") || p.endsWith(".d.ts") || p.endsWith(".test.ts")) continue;
    const out = path.join(dist, path.relative(src, p)).replace(/\.ts$/, ".js");
    if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(p).mtimeMs) stale.push(path.relative(src, p));
  } };
  walk(src);
  return stale;
}

/** The compiler that produced a result: source revision, working-tree diff, whole build, optimizer. */
export function compilerProvenance() {
  const rev = git("rev-parse HEAD"), dirty = git("status --porcelain -- packages/compiler/src") !== "";
  const vendoredOpt = path.join(forkRoot, "vendor/binaryen-133/binaryen-version_133");
  return {
    rev, dirty, srcDiff: dirty ? sha(git("diff HEAD -- packages/compiler/src")) : null, staleDist: staleDist(),
    srcTree: treeHash(path.join(compilerDir, "src"), (p) => p.endsWith(".ts")),
    distTree: treeHash(path.join(compilerDir, "dist"), (p) => p.endsWith(".js")),
    optimizer: { path: path.relative(forkRoot, vendoredOpt), tree: fs.existsSync(vendoredOpt) ? treeHash(vendoredOpt) : "absent" },
    binaryenJs: JSON.parse(fs.readFileSync(path.join(compilerDir, "node_modules/binaryen/package.json"), "utf8")).version,
    node: process.version, arch: process.arch,
  };
}
