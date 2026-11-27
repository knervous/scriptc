#!/usr/bin/env node
// Assembles the WasmGC package from a built workspace (`pnpm install && pnpm -r build`) and packs it.
//
//   node npm/wasmgc/scripts/assemble.mjs [--out=<dir>] [--no-pack]
//
// The stage mirrors the repository's layout for the files the compiler finds relative to itself: the WasmGC emitter
// loads vendor/binaryen-133's wasm-opt.js five directories above dist/backend/wasmgc, so the stage holds
// packages/compiler/dist and vendor/binaryen-133 side by side. Only the WasmGC path is carried: no runtime pack, no LLVM
// helper, no @scriptc/runtime sources.
//
// Dependencies:
// - binaryen 132 (the emitter's module builder, pure JS and wasm) and typescript 5.9 (the source-string parser) are
//   bundled, read from the workspace's own node_modules; binaryen's native command-line tools (bin/) are left out.
// - typescript 7 (the checker the frontend talks to over `tsc --api`) ships one native executable per platform as
//   optional dependencies, so it stays a regular dependency: npm installs the user's platform's build.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const repo = path.resolve(pkgRoot, "../..");
const args = process.argv.slice(2);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const stage = path.resolve(opt("out") ?? path.join(pkgRoot, ".stage"));

const compiler = path.join(repo, "packages/compiler");
const compilerPkg = JSON.parse(fs.readFileSync(path.join(compiler, "package.json"), "utf8"));
if (!fs.existsSync(path.join(compiler, "dist/index.js"))) {
  console.error("assemble: packages/compiler/dist is missing; run `pnpm install && pnpm -r build` first");
  process.exit(1);
}
const wasmOpt = path.join(repo, "vendor/binaryen-133/binaryen-version_133");
for (const f of ["wasm-opt.js", "wasm-opt.wasm"]) {
  if (!fs.existsSync(path.join(wasmOpt, f))) { console.error(`assemble: ${path.join(wasmOpt, f)} is missing`); process.exit(1); }
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// Copies a tree, keeping only the files `keep` admits.
function copyTree(from, to, keep = () => true) {
  let files = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name), dst = path.join(to, entry.name);
    if (entry.isDirectory()) files += copyTree(src, dst, keep);
    else if (entry.isFile() && keep(src)) {
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(src, dst);
      files++;
    }
  }
  return files;
}

// The compiler: its runtime JavaScript, ambient declarations and surface manifest. Tests, source maps and
// declarations are left out.
const runtimeFile = (f) => !/\.test\.(js|d\.ts)$/.test(f) && !f.endsWith(".map") && !f.endsWith(".d.ts");
const stagedCompiler = path.join(stage, "packages/compiler");
copyTree(path.join(compiler, "dist"), path.join(stagedCompiler, "dist"), runtimeFile);
// The maps stay out, so their `//# sourceMappingURL=` comments would point at nothing: strip them.
let strippedMapComments = 0;
(function stripMapComments(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { stripMapComments(file); continue; }
    if (!entry.name.endsWith(".js")) continue;
    const text = fs.readFileSync(file, "utf8");
    const stripped = text.replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/, "\n");
    if (stripped !== text) { fs.writeFileSync(file, stripped); strippedMapComments++; }
  }
})(path.join(stagedCompiler, "dist"));
copyTree(path.join(compiler, "ambient"), path.join(stagedCompiler, "ambient"));
fs.copyFileSync(path.join(compiler, "surface-manifest.json"), path.join(stagedCompiler, "surface-manifest.json"));
fs.copyFileSync(path.join(compiler, "LICENSE"), path.join(stagedCompiler, "LICENSE"));
// Its package.json keeps the name and exports the compiler resolves itself by (dts-paths.js), and no dependencies:
// the outer package supplies them.
fs.writeFileSync(path.join(stagedCompiler, "package.json"), JSON.stringify({
  name: compilerPkg.name, version: compilerPkg.version, license: compilerPkg.license, type: "module",
  main: compilerPkg.main, exports: compilerPkg.exports,
}, null, 2) + "\n");

// wasm-opt 133 as JavaScript and wasm. The vendored release carries no license file; binaryen is Apache-2.0, so its
// license comes from the bundled binaryen package.
const fromCompiler = createRequire(path.join(compiler, "package.json"));
const stagedWasmOpt = path.join(stage, "vendor/binaryen-133/binaryen-version_133");
fs.mkdirSync(stagedWasmOpt, { recursive: true });
for (const f of ["wasm-opt.js", "wasm-opt.wasm"]) fs.copyFileSync(path.join(wasmOpt, f), path.join(stagedWasmOpt, f));
fs.copyFileSync(path.join(path.dirname(fromCompiler.resolve("binaryen/package.json")), "LICENSE"), path.join(stage, "vendor/binaryen-133/LICENSE"));
// wasm-opt.js is CommonJS, and the package root is "type": "module".
fs.writeFileSync(path.join(stage, "vendor/package.json"), JSON.stringify({ type: "commonjs" }) + "\n");

// Bundled dependencies, as the compiler resolves them.
const bundled = {};
// TypeScript 5.9 is only the source-string parser: the compiler calls createSourceFile and transpileModule
// (library/semantic-source.ts, frontend/comptime-node.ts, backend/wasmgc/site-profile.ts), which lib/typescript.js
// serves alone (transpileModule compiles with noLib). The checker, language service, lib.*.d.ts files and
// localized messages stay out; package.json and the license files stay.
const TYPESCRIPT5_FILES = new Set(["package.json", "LICENSE.txt", "ThirdPartyNoticeText.txt", "README.md", "SECURITY.md", path.join("lib", "typescript.js")]);
for (const [folder, keep] of [
  ["binaryen", (f) => !f.includes(`${path.sep}bin${path.sep}`)],
  ["typescript5", (f, root) => TYPESCRIPT5_FILES.has(path.relative(root, f))],
]) {
  const root = path.dirname(fromCompiler.resolve(`${folder}/package.json`));
  const real = fs.realpathSync(root);
  copyTree(real, path.join(stage, "node_modules", folder), (f) => keep(f, real));
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  bundled[folder] = folder === "typescript5" ? `npm:typescript@${version}` : version;
}
const tsgoVersion = JSON.parse(fs.readFileSync(path.join(path.dirname(fromCompiler.resolve("typescript/package.json")), "package.json"), "utf8")).version;

// The source commit, for `scriptw --version`: the checkout's HEAD, marked "-dirty" when tracked files differ from it.
function sourceCommit() {
  if (process.env.SCRIPTW_COMMIT) return process.env.SCRIPTW_COMMIT;
  try {
    const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["-C", repo, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() !== "";
    return dirty ? `${head}-dirty` : head;
  } catch {
    return "unknown";
  }
}

// The package: the template's fields, its bin, lib, README and changelog, and the repository's license files.
const template = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
const { companions, ...fields } = template;
// The publisher's identity (identity.json: the author, and the GitHub repository that builds and publishes the package)
// fills author, repository, homepage and bugs. npm's provenance check needs repository to name the publishing
// repository. Without the file those fields are left out.
const identityFile = path.join(pkgRoot, "identity.json");
const identity = fs.existsSync(identityFile) ? JSON.parse(fs.readFileSync(identityFile, "utf8")) : null;
if (identity === null) console.warn("assemble: npm/wasmgc/identity.json is missing; author, repository, homepage and bugs are left out");
const repoUrl = identity && `https://github.com/${identity.repository}`;
const manifest = {
  ...fields,
  ...(identity === null ? {} : {
    author: identity.author,
    homepage: `${repoUrl}/tree/main/npm/wasmgc#readme`,
    repository: { type: "git", url: `git+${repoUrl}.git`, directory: "npm/wasmgc" },
    bugs: { url: `${repoUrl}/issues` },
  }),
  private: undefined,
  scripts: undefined,
  devDependencies: undefined,
  // The native companions (@scriptw/llvm-*, runtime-*, host-*) are listed only when they are published too
  // (SCRIPTW_COMPANIONS=1): a package must not name optional dependencies the registry does not have. They are
  // released with the package, so each is pinned to the package's own version. bin/native.mjs resolves them either
  // way and names a missing one.
  optionalDependencies: process.env.SCRIPTW_COMPANIONS === "1"
    ? Object.fromEntries(companions.map((name) => [name, template.version]))
    : undefined,
  files: ["bin", "lib", "packages", "vendor", "build-info.json", "LICENSE", "NOTICE", "README.md", "CHANGELOG.md"],
  dependencies: { typescript: tsgoVersion, ...bundled },
  bundleDependencies: Object.keys(bundled),
};
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
const buildInfo = { version: template.version, compiler: compilerPkg.version, typescript: tsgoVersion, commit: sourceCommit() };
fs.writeFileSync(path.join(stage, "build-info.json"), JSON.stringify(buildInfo, null, 2) + "\n");
copyTree(path.join(pkgRoot, "bin"), path.join(stage, "bin"));
copyTree(path.join(pkgRoot, "lib"), path.join(stage, "lib"));
// The README links the repository as {{repository}}, its URL from identity.json.
for (const f of ["README.md", "CHANGELOG.md"]) {
  const text = fs.readFileSync(path.join(pkgRoot, f), "utf8");
  fs.writeFileSync(path.join(stage, f), text.replaceAll("{{repository}}", repoUrl ?? "#repository-not-stamped"));
}
for (const f of ["LICENSE", "NOTICE"]) fs.copyFileSync(path.join(repo, f), path.join(stage, f));

console.log(`assemble: staged ${manifest.name}@${manifest.version} (commit ${buildInfo.commit}) in ${stage}; stripped ${strippedMapComments} sourceMappingURL comments`);
if (!args.includes("--no-pack")) {
  const out = execFileSync("npm", ["pack", "--json"], { cwd: stage, encoding: "utf8" });
  const [info] = JSON.parse(out);
  console.log(`assemble: ${info.filename}: ${info.entryCount} files, ${(info.size / 1e6).toFixed(1)} MB packed, ${(info.unpackedSize / 1e6).toFixed(1)} MB unpacked`);
}
