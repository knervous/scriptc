// Differential sweep (docs-draft/OBJECT_FILES_POC.md): every browser-gate fixture that imports program modules is
// built twice, whole-program and as one object per module linked, and both binaries run under the gate's runner, as
// does the fixture itself under Node (the gate's oracle). Each case is counted by what the linked binary did against
// the oracle and the whole program: exit status (or timeout/signal), stdout and the first error line all compare. A
// refusal (an object or link the PoC does not support) is reported with its reason, never counted as a pass: an
// expected refusal is one of the PoC's known limits (KNOWN_REFUSALS), any other is unexpected.
//
//   node fixtures.mjs [--release] [--lane native|engine|native-any] [--closure | --seeded | --seeded-mixed] [name-regex]
//
// Objects are lowered from the program rooted at the fixture (programRoot, the client's configuration); --closure
// lowers each from its own import graph instead. --seeded takes every object from one lowering of the program
// (compileProgramObjects); --seeded-mixed then recompiles the entry's object alone in header mode, as an incremental
// rebuild with no edit does, and links it with the seeded others. Dev builds by default (the gate's default mode); --release links at
// -O2. Writes wgc-scratch/objects/fixtures-<lane>[-<mode>][-release].json.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(here, "../..");
const dist = path.join(checkout, "packages/compiler/dist");
const { compile } = await import(path.join(dist, "index.js"));
const { compileObject, compileProgramObjects, readObject } = await import(path.join(dist, "link/object.js"));
const { linkWasmGc, LinkError } = await import(path.join(dist, "link/link.js"));
const { frontendDigest } = await import(path.join(dist, "link/object.js"));

const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
const option = (f, d) => { const i = argv.indexOf(f); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const release = flag("--release");
const closure = flag("--closure"), seededMixed = flag("--seeded-mixed"), seeded = flag("--seeded") || seededMixed;
const mode = closure ? "import-closure" : seededMixed ? "seeded-mixed" : seeded ? "seeded" : "programRoot";
const lane = option("--lane", "native");
const filter = argv[0] ? new RegExp(argv[0]) : null;
const target = { browser: true, dynModel: lane === "engine" ? "engine" : "native", experimentalTsNativeAny: lane === "native-any" };
const level = release ? 2 : 0;

const fixtures = path.join(checkout, "tests/wasmgc-browser/fixtures");
const out = path.join(checkout, "wgc-scratch/objects/fixtures", lane);
fs.mkdirSync(out, { recursive: true });

// A module's relative imports (import/export ... from "./x", and literal import("./x")), resolved as Node and the compiler resolve them.
const specifiers = (text) => [...text.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']|^\s*import\s*["'](\.{1,2}\/[^"']+)["']|\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
const resolveSpec = (from, spec) => {
  const base = path.resolve(path.dirname(from), spec);
  const tries = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.js")];
  return tries.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) ?? null;
};
const graph = (entry) => {
  const seen = [], queue = [entry];
  while (queue.length) {
    const f = queue.shift();
    if (seen.includes(f)) continue;
    seen.push(f);
    for (const s of specifiers(fs.readFileSync(f, "utf8"))) { const r = resolveSpec(f, s); if (r && !r.endsWith(".json")) queue.push(r); }
  }
  return seen;
};

// The gate's process outcome (gate.mjs run): exit status or what replaced it, stdout, and the first error line
// normalized (paths and wasm offsets differ by build).
const execute = (args) => {
  const r = spawnSync(process.execPath, ["--import", path.join(checkout, "tests/wasmgc-browser/prelude.mjs"), ...args], { cwd: fixtures, encoding: "utf8", timeout: 60000 });
  const outcome = r.error ? (r.error.code === "ETIMEDOUT" ? "timeout" : `spawn:${r.error.code}`) : r.signal ? `signal:${r.signal}` : `exit:${r.status}`;
  const firstErr = (r.stderr || "").split("\n").find((l) => l.trim() && !/MODULE_TYPELESS_PACKAGE_JSON|^Reparsing as ES module|^To eliminate this warning/.test(l) && !l.startsWith("(Use `node --trace-warnings")) ?? "";
  return { outcome, stdout: r.stdout, error: firstErr.replace(/^Uncaught /, "").replace(/\(.*\)$/, "").replace(/ at .*$/, "").trim() };
};
const runner = (wasm) => execute([path.join(checkout, "tests/wasmgc-browser/run-wasm.mjs"), wasm]);
const agree = (a, b) => a.outcome === b.outcome && a.stdout === b.stdout && a.error === b.error;
const brief = (r) => ({ outcome: r.outcome, stdout: r.stdout.slice(0, 300), error: r.error.slice(0, 200) });
// The PoC's known limits: refusals that say the object path does not support something yet (docs-draft §9/§11).
const KNOWN_REFUSALS = [
  /type-only class modules are not supported by objects yet/,
  /objects do not carry embedded npm graphs or library sections yet/,
  /untagged module globals are not supported by objects yet/,
  /link-time dispatcher synthesis is not implemented/,
  ...(closure ? [/was compiled without .*, a subclass of /] : []),
];

const names = fs.readdirSync(fixtures).filter((f) => f.endsWith(".ts") && (!filter || filter.test(f))).sort();
const results = [];
for (const name of names) {
  const entry = path.join(fixtures, name);
  const src = fs.readFileSync(entry, "utf8");
  const modules = graph(entry);
  if (modules.length < 2) continue;
  // Fixtures the gate runs with host-supplied modules or lane gates are left to the gate.
  // Fixtures with their own options or refusals, or gated to another lane, are left to the gate.
  const gated = /^\/\/ @(options|refuse|native-refuses|native-sim|profile)/m.test(src) || (/^\/\/ @native-only/m.test(src) && lane === "engine") ||
    (/^\/\/ @native-any-only/m.test(src) && lane !== "native-any") || (/^\/\/ @plain-native-only/m.test(src) && lane !== "native");
  if (gated) { results.push({ name, status: "skipped", reason: `lane-gated fixture (${/^\/\/ @([a-z-]+)/m.exec(src)?.[1]})` }); continue; }
  const dir = path.join(out, name.replace(/\.ts$/, ""));
  fs.mkdirSync(dir, { recursive: true });
  const result = { name, modules: modules.length };
  try {
    const whole = path.join(dir, "whole.wasm");
    const r = await compile(entry, { outDir: dir, outPath: whole, outputKind: "wasmgc", ...target, ...(level ? {} : { optimization: "dev" }) });
    if (!r.ok) { results.push({ ...result, status: "skipped", reason: `whole program refused: ${r.diagnostics[0]?.message.slice(0, 160)}` }); continue; }
    const objects = [];
    let objectError = null;
    if (seeded) {
      try {
        const program = await compileProgramObjects(entry, { root: fixtures, outDir: path.join(dir, "seeded"), ...target });
        for (const { file, path: p } of program) if (!(seededMixed && file === entry)) objects.push(p);
        if (seededMixed) {
          // Recompiled against its seed object, as an incremental build does (the roots it defined, §15.4).
          const p = path.join(dir, "entry-header.wobj");
          const seed = program.find((s) => s.file === entry)?.object;
          await compileObject(entry, { root: fixtures, outPath: p, ...target, programRoot: entry, ...(seed ? { seed } : {}) });
          objects.push(p);
        }
      } catch (e) { objectError = `${path.relative(fixtures, entry)}: ${String(e.message).split("\n")[0].replace(fixtures + "/", "")}`; }
    } else for (const m of modules) {
      const p = path.join(dir, path.relative(fixtures, m).replace(/[/\\]/g, "__").replace(/\.(ts|js)$/, ".wobj"));
      try { await compileObject(m, { root: fixtures, outPath: p, ...target, ...(closure ? {} : { programRoot: entry }) }); objects.push(p); }
      catch (e) { objectError = `${path.relative(fixtures, m)}: ${String(e.message).split("\n")[0].replace(fixtures + "/", "")}`; break; }
    }
    // Matched on the whole reason, reported shortened.
    const refusal = (kind, reason) => ({ ...result, status: KNOWN_REFUSALS.some((re) => re.test(reason)) ? "expected-refusal" : "UNEXPECTED-REFUSAL", stage: kind, reason: reason.slice(0, 240) });
    if (objectError) { results.push(refusal("object", objectError)); console.log(`${results.at(-1).status} ${name}  ${results.at(-1).reason}`); continue; }
    let linked;
    try { linked = linkWasmGc(await Promise.all(objects.map(readObject)), { optimizeLevel: level, entry: path.relative(fixtures, entry) }); }
    catch (e) {
      const reason = (e instanceof LinkError ? e.problems[0] : String(e.message).split("\n")[0]).replace(fixtures + "/", "");
      results.push(e instanceof LinkError ? refusal("link", reason) : { ...result, status: "LINK-CRASHED", reason });
      console.log(`${results.at(-1).status} ${name}  ${results.at(-1).reason ?? reason}`); continue;
    }
    const linkedPath = path.join(dir, "linked.wasm");
    fs.writeFileSync(linkedPath, linked.binary);
    const node = execute([entry]), a = runner(whole), b = runner(linkedPath);
    // The linked binary against the oracle first: agreeing with a whole program that is itself wrong is no pass.
    const status = b.outcome === "timeout" ? "TIMEOUT" : b.outcome.startsWith("signal:") || b.outcome.startsWith("spawn:") ? "CRASHED"
      : agree(b, node) ? (agree(a, node) ? "correct" : "correct-whole-differs")
      : agree(b, a) ? "shared-failure" : "MISMATCH";
    results.push({ ...result, status, ...(status === "correct" ? {} : { node: brief(node), whole: brief(a), linked: brief(b) }), wholeBytes: fs.statSync(whole).size, linkedBytes: linked.binary.length });
  } catch (e) {
    results.push({ ...result, status: "DRIVER-CRASHED", reason: String(e.message).split("\n")[0].slice(0, 240) });
  }
  const last = results.at(-1);
  if (last.status !== "skipped") console.log(`${last.status.padEnd(14)} ${name}${last.reason ? `  ${last.reason}` : ""}`);
}
const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
const git = (args) => spawnSync("git", args, { cwd: checkout, encoding: "utf8" }).stdout.trim();
const provenance = { compilerHead: git(["rev-parse", "HEAD"]), dirty: git(["status", "--porcelain", "--", "packages/compiler/src"]) !== "", frontend: frontendDigest(), node: process.version, lane, target, mode, level, filter: filter?.source ?? null };
fs.writeFileSync(path.join(checkout, "wgc-scratch/objects", `fixtures-${lane}${mode === "programRoot" ? "" : `-${mode}`}${release ? "-release" : ""}.json`), JSON.stringify({ provenance, counts, results }, null, 2) + "\n");
console.log(JSON.stringify(counts));
// Upper-case statuses are failures of the object path (or of the driver).
process.exitCode = results.some((r) => /^[A-Z]/.test(r.status)) ? 1 : 0;
