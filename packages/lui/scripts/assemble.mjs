// Stages @scriptw/lui for publishing and packs it, as npm/wasmgc/scripts/assemble.mjs does for scriptw:
// - checks that src/stream is current (sync-stream.mjs);
// - builds dist/ (plain JavaScript for the default condition; the `wasmgc` condition keeps the TypeScript sources);
// - writes the published manifest: package.json without `private`, with author, repository, homepage and bugs from
//   npm/wasmgc/identity.json (the publisher's identity, kept in that one file);
// - copies src, dist, docs, README.md, LICENSE and NOTICE, and runs npm pack in the stage.
//
//   node packages/lui/scripts/assemble.mjs [--stage <dir>] [--no-pack]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { stale } from "./sync-stream.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const repo = path.resolve(pkg, "../..");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : args[i + 1]; };
const stage = path.resolve(opt("stage", path.join(pkg, ".stage")));

const behind = stale();
if (behind.length) { console.error(`assemble: src/stream is out of date (${behind.join(", ")}): run scripts/sync-stream.mjs`); process.exit(1); }

const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsx/package.json", { paths: [repo] }))("esbuild");
fs.rmSync(path.join(pkg, "dist"), { recursive: true, force: true });
await esbuild.build({
  entryPoints: ["index", "jsx-runtime", "jsx-dev-runtime", "dom", "dom-stream"].map((f) => path.join(pkg, "src", `${f}.ts`)),
  outdir: path.join(pkg, "dist"), bundle: true, splitting: true, format: "esm", target: "es2022", platform: "neutral",
  // The DOM module stays an import, resolved by the package's own `imports` at run time; host modules belong to WasmGC hosts.
  external: ["#dom", "host:*"], logLevel: "warning",
});

const manifest = JSON.parse(fs.readFileSync(path.join(pkg, "package.json"), "utf8"));
delete manifest.private;
const identityFile = path.join(repo, "npm/wasmgc/identity.json");
if (fs.existsSync(identityFile)) {
  const identity = JSON.parse(fs.readFileSync(identityFile, "utf8"));
  const url = `https://github.com/${identity.repository}`;
  Object.assign(manifest, { author: identity.author, homepage: `${url}/tree/main/packages/lui#readme`,
    repository: { type: "git", url: `git+${url}.git`, directory: "packages/lui" }, bugs: { url: `${url}/issues` } });
} else console.warn("assemble: npm/wasmgc/identity.json is missing; author, repository, homepage and bugs are left out");

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
for (const f of manifest.files) fs.cpSync(path.join(pkg, f), path.join(stage, f), { recursive: true });
console.log(`assemble: staged ${manifest.name}@${manifest.version} in ${stage}`);
if (!args.includes("--no-pack")) {
  const [info] = JSON.parse(execFileSync("npm", ["pack", "--json"], { cwd: stage, encoding: "utf8" }));
  console.log(`assemble: ${path.join(stage, info.filename)}: ${info.entryCount} files, ${(info.size / 1e3).toFixed(0)} kB packed`);
}
