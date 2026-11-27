// The browser-profile JS corpus lane: every top-level .js/.cjs/.mjs program in
// tests/corpus, compiled with the real browser options for one dyn model, run
// in its own process, and classified against Node:
//   pass              stdout and exit status match Node
//   mismatch          ran, but output or status differ
//   backend-gap       compile-time: the WasmGC backend does not support a form yet
//   frontend-refusal  compile-time: an explicit SC-coded frontend refusal
//   checker           compile-time: a TypeScript checker diagnostic
//   runtime-fence     ran into an explicit refusal at run time ("not supported", or a
//                     deferred SC-coded diagnostic) with Node's output up to that point
//   crash             the compiler threw (an internal error)
//   trap              a wasm trap / host failure outside the program's semantics
//   excluded          uses Node-only surface the browser profile does not provide
// No case is required to pass; the inventory and its classification are the
// baseline. `@dynamic` entries are included (their flag is recorded).
//   node corpus-js.mjs [--dyn native|engine] [--i31] [--jobs N] [--filter s] [--out report.json]
//   --i31: native dyn with experimentalDynI31 (small integers as i31ref)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilerProvenance, sha } from "../provenance.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.resolve(here, "../corpus");
const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i < 0 ? d : argv[i + 1]; };

if (argv[0] === "--compile") {
  // Child: compile one program for the browser profile, print a JSON line.
  const [, src, out, dynModel, i31] = argv;
  const { compile } = await import(path.resolve(here, "../../packages/compiler/dist/index.js"));
  let line;
  try {
    const r = await compile(src, { outDir: path.dirname(out), outPath: out, outputKind: "wasmgc", browser: true, dynModel, ...(i31 === "i31" ? { experimentalDynI31: true } : {}), optimization: "dev" });
    line = r.ok ? { ok: true } : { ok: false, reason: r.diagnostics.map((d) => d.message).join(" | ").slice(0, 400) };
  } catch (e) { line = { ok: false, crash: true, reason: String(e?.stack ?? e).slice(0, 400) }; }
  await new Promise((resolve) => process.stdout.write(JSON.stringify(line) + "\n", resolve));
  process.exit(0);
}
if (process.env.CORPUS_JS_CHILD) { console.error("corpus-js: refusing to fan out inside a child"); process.exit(1); }

const dynModel = opt("--dyn", "native"), i31 = argv.includes("--i31"), filter = opt("--filter", ""), jobs = Math.max(1, Number(opt("--jobs", "2")));
const NODE_ONLY = /from\s+['"](node:|fs|path|os|net|https?|http2|child_process|crypto|zlib|stream|events|util|dgram|tls|readline|worker_threads|assert|buffer|module|perf_hooks|timers|v8|vm|url|string_decoder|querystring|cluster|dns|inspector|async_hooks|diagnostics_channel|test)['"/]|import\(\s*['"]node:|\brequire\(\s*['"](node:)?(fs|path|os|net|https?|child_process|crypto|zlib|stream|events|util|readline|worker_threads|assert|buffer|module|vm|url|dns|tls|dgram|cluster|v8|perf_hooks|timers|string_decoder|querystring|inspector|async_hooks)['"]|\bprocess\.(argv|env|exit|on|stdout|stderr|stdin|nextTick|cwd|chdir|hrtime|memoryUsage|platform|pid|exitCode)|\bBuffer\b|__dirname|__filename/;
const files = fs.readdirSync(corpus).filter((f) => /\.(js|cjs|mjs)$/.test(f) && f.includes(filter)).sort();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-js-"));
const run = (args, timeout, extra = {}) => new Promise((resolve) => {
  const p = spawn("nice", ["-n", "10", process.execPath, "--max-old-space-size=1536", ...args], { cwd: corpus, env: { ...process.env, CORPUS_JS_CHILD: "1" }, ...extra });
  let out = "", err = "";
  const t = setTimeout(() => p.kill("SIGKILL"), timeout);
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code, signal) => { clearTimeout(t); resolve({ code: signal ? `signal:${signal}` : code, out, err }); });
});
const firstError = (err) => (err.split("\n").find((l) => /Error|error|Uncaught/.test(l)) ?? err.split("\n")[0] ?? "").trim().slice(0, 300);
const results = [];
let next = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++], full = path.join(corpus, file), src = fs.readFileSync(full, "utf8");
    const item = { file, dynamic: /^\/\/ @dynamic\s*$/m.test(src.split("\n").slice(0, 8).join("\n")), input: sha(src) };
    if (NODE_ONLY.test(src)) { item.status = "excluded"; item.reason = "Node-only surface"; results.push(item); continue; }
    const wasm = path.join(outDir, file.replace(/\.[cm]?js$/, "") + ".wasm");
    const c = await run([fileURLToPath(import.meta.url), "--compile", full, wasm, dynModel, ...(i31 ? ["i31"] : [])], 120000);
    let compiled;
    try { compiled = JSON.parse(c.out.trim().split("\n").pop()); } catch { compiled = { ok: false, crash: true, reason: firstError(c.err) || `compile child exited ${c.code}` }; }
    if (!compiled.ok) {
      item.status = compiled.crash ? "crash" : /wasmgc backend does not support/.test(compiled.reason) ? "backend-gap"
        : /\[SC\d+|not supported yet|has no scriptc lowering/.test(compiled.reason) ? "frontend-refusal" : "checker";
      item.reason = compiled.reason; results.push(item); continue;
    }
    const mine = await run([path.join(here, "run-wasm.mjs"), wasm], 30000);
    const oracle = await run([full], 30000);
    const same = mine.out === oracle.out && (mine.code === 0) === (oracle.code === 0);
    // A runtime fence is an explicit refusal reached at run time (a "not supported"
    // TypeError or a deferred SC-coded diagnostic, "[SC2020 at file:line]") that
    // explains the first divergence from Node: uncaught after Node's output so far,
    // or caught and printed on the first line that differs. Output that was already
    // wrong before the refusal is a mismatch.
    const fence = /not supported yet|(?:is|are) not supported|\[SC\d{4} at /;
    const got = mine.out.split("\n"), want = oracle.out.split("\n");
    let at = 0;
    while (at < got.length && at < want.length && got[at] === want[at]) at++;
    const fenced = (fence.test(mine.err) && oracle.out.startsWith(mine.out)) || fence.test(got[at] ?? "");
    if (same) item.status = "pass";
    else if (fenced) { item.status = "runtime-fence"; item.reason = fence.test(got[at] ?? "") ? got[at].trim().slice(0, 300) : firstError(mine.err); }
    else if (/RuntimeError|LinkError|CompileError/.test(mine.err)) { item.status = "trap"; item.reason = firstError(mine.err); }
    else { item.status = "mismatch"; item.reason = `got ${JSON.stringify(mine.out.slice(0, 120))} exit ${mine.code}; want ${JSON.stringify(oracle.out.slice(0, 120))} exit ${oracle.code}; ${firstError(mine.err)}`; }
    results.push(item);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));
fs.rmSync(outDir, { recursive: true, force: true });
results.sort((a, b) => a.file.localeCompare(b.file));
const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
const byExt = {};
for (const r of results) { const e = r.file.split(".").pop(); byExt[e] ??= {}; byExt[e][r.status] = (byExt[e][r.status] ?? 0) + 1; }
// The most common reasons per status (normalised: paths and quoted names elided).
const norm = (r) => (r ?? "").replace(/\(in [^)]*\)/g, "").replace(/'[^']*'/g, "'…'").replace(/\s+@.*$/, "").slice(0, 110);
const topReasons = {};
for (const r of results) { if (r.status === "pass" || !r.reason) continue; const k = `${r.status}: ${norm(r.reason.split(" | ")[0])}`; topReasons[k] = (topReasons[k] ?? 0) + 1; }
const report = { lane: "browser-js-corpus", dynModel, ...(i31 ? { experimentalDynI31: true } : {}), topReasons: Object.fromEntries(Object.entries(topReasons).sort((a, b) => b[1] - a[1]).slice(0, 40)), date: new Date().toISOString(), compiler: compilerProvenance(), total: results.length, counts, byExt, results };
const out = opt("--out", path.join(here, "reports", `corpus-js-${dynModel}${i31 ? "-i31" : ""}-${report.compiler.rev.slice(0, 12)}${report.compiler.dirty ? "-dirty" : ""}-${Date.now().toString(36)}.json`));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 1) + "\n");
for (const [k, v] of Object.entries(report.topReasons).slice(0, 15)) console.log(String(v).padStart(4), k);
console.log(`${dynModel}: ${results.length} programs ${JSON.stringify(counts)}  by extension ${JSON.stringify(byExt)}\nreport ${path.relative(process.cwd(), out)}`);
