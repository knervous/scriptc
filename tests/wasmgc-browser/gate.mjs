// The browser-profile differential gate for the WasmGC backend.
//
// Every fixture compiles with the real browser options (browser: true,
// engine-backed dyn), runs in its own process, and must match Node running
// the same source: stdout byte for byte and the exact process outcome. A
// fixture may instead declare an explicit restricted-profile refusal:
//
//   // @refuse: <diagnostic substring>
//
// which passes only when every build refuses with that diagnostic, or a
// named profile divergence (a documented checked-boundary rule):
//
//   // @profile: <reason>
//   // @expect: <stdout line>      (one per expected line)
//
// which passes only on exactly the expected output; the receipt records the
// reason beside the oracle's output, and the summary counts divergences.
// A native-model explicit refusal (an operation the native object model
// rejects before any change, pending support) is its own classification:
//
//   // @native-refuses: <reason>
//   // @expect-native: <stdout line>   (one per expected line)
//
// It applies only under --dyn native (engine must still match Node), and the
// summary lists these separately from the accepted profile divergences.
//   // @expect-native-fence: <error substring>   with @native-refuses: the refusal
//       is a fence that must reach the top level (uncaught, exit 1, first error
//       line containing the substring) after the expected stdout, never the
//       program's own catch.
//   // @native-only: <reason>   a native capability engine dyn lacks: the engine
//                               lane skips the fixture and lists it as skipped.
//   // @plain-native-only: <reason>   the plain native lane (dyn native, no native any): the other lanes skip it.
//   // @native-any-only: <reason>   TS `any` behavior only the --native-any lane
//                                   represents natively: other lanes skip it.
//   // @known-defect(<lanes>): <reason>   a reproduced defect, not yet fixed, in
//       the listed lanes (engine, native, native-any). There the fixture must
//       still FAIL (reported as "xfail", listed in the receipt); once it passes
//       the gate fails until the directive is removed, so a fix is noticed.
//       Other lanes judge it normally. Keep each such fixture to one defect.
//   // @known-defect-expect: compile: <diagnostic substring>
//   // @known-defect-expect: run: <outcome> <error substring>
//   // @known-defect-expect: stdout: <substring of the wrong output>
//       pins the expected failure to a signature (known-defect.mjs): every build
//       must fail that way, so a crash or any other failure does not count as
//       the defect. Without it the @known-defect is an unsigned inversion
//       (receipt: knownDefectUnsigned). Compile: a diagnostic containing the
//       text. Run: the exact outcome (exit:1, signal:SIGABRT, ...) and a first
//       error line containing the text. Stdout: exit:0 with output containing
//       the text (a wrong-output defect).
//   // @release-refuses: <diagnostic>   a fence the dev build defers to run time (the program never
//       reaches it): the dev build runs and matches Node, and a strict release build (--strict-release,
//       --production) refuses at compile time with that diagnostic; a release build that compiles fails.
//   // @options: <JSON object>   extra compile options for this fixture (an
//       opt-in compile profile under test); pair it with @native-only when the
//       option needs the native model. Under --production a fixture may not
//       override the production recipe's options.
//   // @hits[(<lanes>)]: <regex>   fast-path coverage: in the dev build, some
//       function whose name matches <regex> must be entered at least once
//       (fnprobe.mjs counts entries). An output-only comparison passes even
//       when an emitted fast path is never taken; this does not. Lanes as for
//       @known-defect; without a lane list it applies in every lane.
// Exit status is nonzero on any failure. Each run writes an immutable receipt
// named by compiler revision under reports/. Built binaries are named by lane
// (.out/<fixture>.<lane>.<mode>.wasm) so concurrent lanes never share a file.
//
// Refusals happen before any work is dispatched, and write an unsuccessful
// receipt (reports/refused-*.json, ok: false) with the reasons: an unknown or
// malformed option, an unknown fixture name, or a compiler dist older than its
// source. There is no bypass for a stale dist: rebuild packages/compiler (delete
// the repo-root node_modules/.cache/scriptc-tsc/compiler.tsbuildinfo first,
// so tsc re-emits every output). The compiler is fingerprinted before
// dispatch and again after execution; a change in between marks the receipt
// unsuccessful (ok: false, "unsuccessful" names the changed fields).
//
//   node gate.mjs <fixture ...>        iterate: dev builds only
//   node gate.mjs --full <fixture ...> validate: dev and release (before a commit)
//   --all                              the whole corpus; required when no fixture is named
//                                      (no names and no --all is refused)
//   --production                       the production recipe (scripts/wasmgc/link.mjs):
//                                      browser, --dyn native, native-any, interface class
//                                      arms, the "wasmgc" condition, strict release. Implies
//                                      --full --strict-release --native-any. Takes no
//                                      --specialize, --i31 or --inline-slots.
//   --native-sim                       the native-host simulation lane: every fixture that compiles
//                                      with the hostHandles option (@options {"hostHandles": true}),
//                                      native-any, run with SCRIPTC_WASMGC_NATIVE_SIM=1 (js.dynFacade
//                                      answers the compiled value itself, an identity token, as the
//                                      native host does), so a path that still needs a page facade fails
//                                      here instead of in the Rust host. Only hostHandles fixtures are
//                                      selected (--all); a named fixture always runs. Compiled with noPageFacades,
//                                      as the native build is (no per-type facade exports). A fixture that needs a real page
//                                      declares `// @native-sim-skip: <reason>` and is skipped, listed.
//   --jobs N                           parallel workers (default 2, niced)
//   --no-batch                         one TypeScript program per compile
//   --dyn native                       untyped JS as compiled wasm values
//                                      (default engine; any other value is refused)
//   --specialize guarded               opt-in native property-read fast paths
//   --i31                              native: every fixture with experimentalDynI31
//                                      (small integers as i31ref in dyn)
//   --fuse-casts                       every fixture with fuseTestCasts (test-then-cast pairs fused into br_on_cast)
//   --inline-slots N                   native: every fixture with experimentalDynInlineSlots N
//                                      (the first N property slots inside the object; the
//                                      compiler default is 5, and --inline-slots 0 turns it off)
//
// Speed: compiles dominate (the TypeScript program load is seconds; a run is
// ~45 ms), so workers share one tsgo server each (SCRIPTC_SHARE_TS7_HOST) and
// fixtures are split across a small number of niced workers.
import { spawn, spawnSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilerProvenance, staleDist } from "../provenance.mjs";
import { instrument } from "./fnprobe.mjs";
import { judgeKnownDefect, parseKnownDefectExpect } from "./known-defect.mjs";
import { fixtureDirs, fixtureIndex, reportsDir } from "./fixture-dirs.mjs";

const phaseStart = performance.now();
// Pinned runtime capability: retained byte views need resizable memory
// buffers (Node 26+; Node 24 lacks Memory.prototype.toResizableBuffer).
if (typeof WebAssembly.Memory.prototype.toResizableBuffer !== "function") {
  console.error(`gate: this Node (${process.version}) lacks WebAssembly.Memory.prototype.toResizableBuffer; run the gate with Node 26+ (e.g. /opt/homebrew/bin/node)`);
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
// The fixtures: the public ones in fixtures/ and, in a tree with the private layer, its own (fixture-dirs.mjs).
const fixtureFiles = fixtureIndex(), out = path.join(here, ".out"), reports = reportsDir;
const fixtureFile = (n) => fixtureFiles.get(n);
const prelude = path.join(here, "prelude.mjs"), runner = path.join(here, "run-wasm.mjs");
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(reports, { recursive: true });
if (process.arch !== "arm64" && !process.env.GATE_ANY_ARCH) {
  console.error(`gate: node is ${process.arch}; put /opt/homebrew/bin first on PATH (or set GATE_ANY_ARCH=1)`);
  process.exit(2);
}

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const git = (cmd) => { try { return execSync(`git ${cmd}`, { cwd: here, encoding: "utf8" }).trim(); } catch { return ""; } };
// Hash of every file under a directory, by name and content.
const dirHash = (dir, filter) => sha(fs.readdirSync(dir).filter(filter).sort().map((f) => f + ":" + sha(fs.readFileSync(path.join(dir, f), "utf8"))).join("\n"));
const compilerDist = path.join(here, "../../packages/compiler/dist/backend/wasmgc");
/** The compiler as it is on disk: source and dist identity, the whole build, the host adapter. */
const compilerCut = () => ({
  provenance: compilerProvenance(),
  compilerBuild: dirHash(compilerDist, (f) => f.endsWith(".js")),
  hostAdapter: sha(fs.readFileSync(path.join(compilerDist, "host.js"), "utf8")),
});

/** Refuses before any dispatch: writes an unsuccessful receipt, then exits 2. */
const refuse = (reasons) => {
  const receipt = { ok: false, refused: reasons, argv: process.argv.slice(2), compiler: git("rev-parse HEAD"), node: process.version, arch: process.arch, date: new Date().toISOString() };
  const name = `refused-${Date.now().toString(36)}-${process.pid}.json`;
  fs.writeFileSync(path.join(reports, name), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.error(`gate: REFUSED before dispatch: ${reasons.join("; ")}  (receipt ${path.relative(here, path.join(reports, name))})`);
  process.exit(2);
};

const argv = process.argv.slice(2);
const problems = [];
const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
const option = (f, dflt) => {
  const i = argv.indexOf(f); if (i < 0) return dflt;
  if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) { problems.push(`${f} needs a value`); argv.splice(i, 1); return dflt; }
  const v = argv[i + 1]; argv.splice(i, 2); return v;
};
const worker = flag("--worker"), production = flag("--production"), selectAll = flag("--all");
let full = flag("--full"), strictRelease = flag("--strict-release");
const noBatch = flag("--no-batch");
const jobsArg = option("--jobs", "2"), jobs = Number(jobsArg);
const dynArg = option("--dyn", undefined);
let nativeAny = flag("--native-any");
const nativeSim = flag("--native-sim");
const i31 = flag("--i31");
const fuseCasts = flag("--fuse-casts");
const specialize = option("--specialize", undefined);
const inlineSlotsArg = option("--inline-slots", null), inlineSlots = inlineSlotsArg === null ? null : Number(inlineSlotsArg);
const only = argv.filter((a) => !a.startsWith("--"));
for (const a of argv.filter((a) => a.startsWith("--"))) problems.push(`unknown option ${a}`);
if (!Number.isInteger(jobs) || jobs < 1) problems.push(`--jobs must be a positive integer (got ${JSON.stringify(jobsArg)})`);
if (dynArg !== undefined && !["engine", "native"].includes(dynArg)) problems.push(`unknown --dyn value ${JSON.stringify(dynArg)} (valid: engine, native; the native-any lane is --dyn native --native-any)`);
if (production && dynArg !== undefined && dynArg !== "native") problems.push("--production is the native recipe: --dyn must be native or omitted");
if (production && (specialize !== undefined || i31 || inlineSlots !== null)) problems.push("--production is the production recipe as it is: no --specialize, --i31 or --inline-slots");
const dynModel = production || nativeSim || dynArg === "native" ? "native" : "engine";
if (production) { full = true; strictRelease = true; nativeAny = true; }
if (nativeSim) nativeAny = true;
if (nativeSim && production) problems.push("--native-sim is its own lane: it takes no --production");
// --strict-release (requires --full): the release-mode compile sets `release: true`, so a
// reachable runtime fence refuses at compile time instead of building. Dev stays as it is.
if (strictRelease && !full) problems.push("--strict-release requires --full");
if (i31 && dynModel !== "native") problems.push("--i31 requires --dyn native");
if (inlineSlots !== null && (!Number.isInteger(inlineSlots) || inlineSlots < 0)) problems.push(`--inline-slots must be a non-negative integer (got ${JSON.stringify(inlineSlotsArg)})`);
if (inlineSlots !== null && dynModel !== "native") problems.push("--inline-slots requires --dyn native");
if (nativeAny && dynModel !== "native") problems.push("--native-any requires --dyn native");
if (specialize !== undefined && (specialize !== "guarded" || dynModel !== "native")) problems.push("--specialize guarded requires --dyn native");
const modes = full ? ["dev", "release"] : ["dev"];
const lane = nativeSim ? "native-sim" : nativeAny ? "native-any" : dynModel === "native" ? "native" : "engine";
const laneTag = lane + (strictRelease ? "-strict" : "") + (specialize ? "-guarded" : "") + (i31 ? "-i31" : "") + (fuseCasts ? "-fuse" : "") + (inlineSlots !== null ? `-inl${inlineSlots}` : "") + (production ? "-prod" : "");
const lanesOf = (list) => list === undefined || list.split(",").map((x) => x.trim()).includes(lane) || (nativeSim && list.split(",").map((x) => x.trim()).includes("native-any"));
// The production recipe (scripts/wasmgc/link.mjs). A fixture may not override these.
const PRODUCTION_OPTIONS = { browser: true, dynModel: "native", experimentalTsNativeAny: true, interfaceClassArms: true, conditions: ["wasmgc"] };
const allNames = [...fixtureFiles.keys()];
const unknownFixtures = only.filter((n) => !allNames.includes(n));
if (unknownFixtures.length) problems.push(`unknown fixture${unknownFixtures.length > 1 ? "s" : ""}: ${unknownFixtures.join(", ")} (fixtures are ${fixtureDirs.map((d) => path.relative(process.cwd(), d)).join(" and ")}/<name>.ts; give the name without .ts)`);
// Explicit selection: an empty filter must never silently become the corpus.
if (selectAll && only.length) problems.push("--all and explicit fixture names are mutually exclusive");
if (!only.length && !selectAll) problems.push(`no fixtures selected: name the fixtures to run, or pass --all for the whole corpus (${allNames.length} fixtures)`);
if (problems.length) refuse(problems);
const usesHostHandles = (n) => /^\/\/ @options: .*"hostHandles"\s*:\s*true/m.test(fs.readFileSync(fixtureFile(n), "utf8"));
const names = (only.length ? allNames.filter((n) => only.includes(n)) : allNames).filter((n) => !nativeSim || (only.length ? true : usesHostHandles(n)));
const sortedOnly = only.length ? only : null;
// The options every compile of this run carries, before per-fixture @options.
const effective = {
  recipe: production ? "production" : "legacy", browser: true, outputKind: "wasmgc", dynModel, experimentalTsNativeAny: nativeAny,
  interfaceClassArms: production, conditions: production ? ["wasmgc"] : null,
  experimentalJsSpecialize: specialize ?? null, experimentalDynI31: i31, fuseTestCasts: fuseCasts, noPageFacades: nativeSim, experimentalDynInlineSlots: inlineSlots,
  modes, optimization: "dev in dev mode, release in release mode", release: strictRelease ? "release: true in release mode (strict)" : "not set", lane: laneTag,
};

// A dist older than its source runs the previous compiler while the receipt
// describes the edited source. By mtime, so a file only touched since the
// build is also listed (tsc does not re-emit an unchanged file): the remedy is
// a full re-emit, which clears the list without any bypass.
if (!worker) {
  const stale = staleDist();
  if (stale.length) refuse([`compiler dist is older than its source (${stale.slice(0, 3).join(", ")}${stale.length > 3 ? `, +${stale.length - 3}` : ""}): rebuild packages/compiler after deleting node_modules/.cache/scriptc-tsc/compiler.tsbuildinfo so every output is re-emitted`]);
}
if (!worker) console.log(`gate: resolved ${names.length} fixture${names.length === 1 ? "" : "s"} (${only.length ? "explicit" : "--all"}), profile ${effective.recipe} (lane ${laneTag}, ${modes.join("+")}, dyn ${dynModel}), ${jobs} job${jobs === 1 ? "" : "s"}`);
const batch = noBatch ? undefined : names.map(fixtureFile);

// Phase timing (performance.now(), monotonic). Compile and run are accumulated
// by every compile and every spawned run in this process.
const acc = { compileMs: 0, runMs: 0 };
// Exact process outcome: exit status, or the signal/timeout/spawn failure that replaced it.
// Each fixture runs from its own directory.
const run = (args, env, cwd) => {
  const t = performance.now();
  const r = spawnSync(process.execPath, ["--import", prelude, ...args], { cwd, encoding: "utf8", timeout: 20000, ...(env ? { env: { ...process.env, ...env } } : {}) });
  acc.runMs += performance.now() - t;
  const outcome = r.error ? (r.error.code === "ETIMEDOUT" ? "timeout" : `spawn:${r.error.code}`) : r.signal ? `signal:${r.signal}` : `exit:${r.status}`;
  // The first error line, normalized (paths and wasm offsets differ by build).
  const firstErr = (r.stderr || "").split("\n").find((l) => l.trim() && !l.includes("MODULE_TYPELESS_PACKAGE_JSON") && !l.startsWith("(Use `node --trace-warnings")) ?? "";
  const error = firstErr.replace(/^Uncaught /, "").replace(/\(.*\)$/, "").replace(/ at .*$/, "").trim();
  return { stdout: r.stdout, outcome, error, stderr: firstErr };
};

/** One fixture, every requested mode. */
async function check(compile, name) {
  const acc0 = { ...acc };
  const file = fixtureFile(name), src = fs.readFileSync(file, "utf8");
  const refuse = /^\/\/ @refuse: (.+)$/m.exec(src)?.[1]?.trim();
  // `// @native-only: <reason>` — a native-model capability the engine model
  // lacks; the engine lane skips it (counted and listed, never silently).
  const nativeOnly = /^\/\/ @native-only: (.+)$/m.exec(src)?.[1]?.trim();
  if (nativeOnly && dynModel !== "native") return { name, input: sha(src), skipped: nativeOnly, ok: true, builds: [] };
  // The native-host simulation lane runs hostHandles fixtures only; one that needs a real page says why.
  if (nativeSim) {
    // (A fixture named on the command line runs even without the hostHandles option, to check a family by hand.)
    if (!only.length && !usesHostHandles(name)) return { name, input: sha(src), skipped: "native-sim: not a hostHandles fixture", ok: true, builds: [] };
    const simSkip = /^\/\/ @native-sim-skip: (.+)$/m.exec(src)?.[1]?.trim();
    if (simSkip) return { name, input: sha(src), skipped: `native-sim-skip: ${simSkip}`, ok: true, builds: [] };
  }
  const nativeAnyOnly = /^\/\/ @native-any-only: (.+)$/m.exec(src)?.[1]?.trim();
  if (nativeAnyOnly && !nativeAny) return { name, input: sha(src), skipped: `native-any-only: ${nativeAnyOnly}`, ok: true, builds: [] };
  // @plain-native-only: the plain native lane (dyn native without native any): TS `any` is a page value there, so its crossings have
  // lane-specific answers (exact facades, or a loud TypeError naming the limitation); every other lane skips the fixture.
  const plainOnly = /^\/\/ @plain-native-only: (.+)$/m.exec(src)?.[1]?.trim();
  if (plainOnly && (dynModel !== "native" || nativeAny)) return { name, input: sha(src), skipped: `plain-native-only: ${plainOnly}`, ok: true, builds: [] };
  const defect = /^\/\/ @known-defect\(([^)]*)\): (.+)$/m.exec(src);
  const knownDefect = defect && lanesOf(defect[1]) ? defect[2].trim() : undefined;
  const extraOptions = JSON.parse(/^\/\/ @options: (.+)$/m.exec(src)?.[1] ?? "{}");
  if (production) {
    const clash = Object.keys(PRODUCTION_OPTIONS).filter((k) => k in extraOptions && JSON.stringify(extraOptions[k]) !== JSON.stringify(PRODUCTION_OPTIONS[k]));
    if (clash.length) return { name, input: sha(src), ok: false, builds: [{ mode: "all", ok: false, why: `@options overrides the production recipe (${clash.join(", ")})` }] };
  }
  const hitSpecs = [...src.matchAll(/^\/\/ @hits(?:\(([^)]*)\))?: (.+)$/gm)].filter((x) => lanesOf(x[1])).map((x) => x[2].trim());
  const nativeRefusal = dynModel === "native" ? /^\/\/ @native-refuses: (.+)$/m.exec(src)?.[1]?.trim() : undefined;
  const profile = /^\/\/ @profile: (.+)$/m.exec(src)?.[1]?.trim();
  const expected = profile ? [...src.matchAll(/^\/\/ @expect: ?(.*)$/gm)].map((x) => x[1] + "\n").join("")
    : nativeRefusal ? [...src.matchAll(/^\/\/ @expect-native: ?(.*)$/gm)].map((x) => x[1] + "\n").join("") : null;
  const jsRun = refuse ? null : run([file], undefined, path.dirname(file));
  // A profile divergence is judged against its declared output, never silently.
  const nativeFence = nativeRefusal ? /^\/\/ @expect-native-fence: (.+)$/m.exec(src)?.[1]?.trim() : undefined;
  // @release-refuses: <diagnostic substring>: the dev build runs and matches; a strict release build (--strict-release / --production)
  // refuses at compile time with that diagnostic (a fence the dev build defers to run time, reached only if the program uses it).
  const releaseRefuses = strictRelease ? /^\/\/ @release-refuses: (.+)$/m.exec(src)?.[1]?.trim() : undefined;
  const oracle = profile || nativeRefusal ? { stdout: expected, outcome: nativeFence ? "exit:1" : "exit:0", error: nativeFence ?? "", stderr: "" } : jsRun;
  const item = { name, input: sha(src), refuse, profile, nativeRefusal, options: extraOptions, ...(profile ? { divergence: { reason: profile, jsStdout: jsRun.stdout, expected } } : {}),
    ...(nativeRefusal ? { refusal: { reason: nativeRefusal, jsStdout: jsRun.stdout, expected } } : {}), oracle, builds: [], ok: true };
  for (const mode of modes) {
    const wasm = path.join(out, `${name}.${laneTag}.${mode}.wasm`);
    fs.rmSync(wasm, { force: true });
    let r;
    const tc = performance.now();
    try {
      r = await compile(file, { outDir: out, outPath: wasm, outputKind: "wasmgc", browser: true, dynModel, ...(nativeAny ? {experimentalTsNativeAny:true}:{}), ...(production ? { interfaceClassArms: true, conditions: ["wasmgc"] } : {}), ...(specialize ? { experimentalJsSpecialize: specialize } : {}), ...(i31 ? { experimentalDynI31: true } : {}), ...(fuseCasts ? { fuseTestCasts: true } : {}), ...(nativeSim ? { noPageFacades: true } : {}), ...(inlineSlots !== null ? { experimentalDynInlineSlots: inlineSlots } : {}), ...extraOptions, batchRoots: batch, ...(mode === "dev" ? { optimization: "dev" } : {}), ...(strictRelease && mode === "release" ? { release: true } : {}) });
    } catch (e) {
      // A compiler crash is a failure of this fixture, never of the gate.
      r = { ok: false, diagnostics: [{ message: `compiler crash: ${String(e?.message ?? e).split("\n")[0]}` }], crashed: true };
    }
    acc.compileMs += performance.now() - tc;
    const build = { mode, compiled: r.ok, ...(r.crashed ? { crashed: true } : {}) };
    if (!r.ok) {
      build.diagnostics = r.diagnostics.map((d) => d.message.split("\n")[0]).slice(0, 3);
      // An internal compiler error (SC9001: a verifier or lowering bug) is never an accepted outcome, whatever the fixture declares.
      const ice = r.diagnostics.some((d) => /internal compiler error/.test(d.message));
      build.ok = !r.crashed && !!refuse && r.diagnostics.some((d) => d.message.includes(refuse));
      if (!build.ok && !r.crashed && releaseRefuses && mode === "release" && r.diagnostics.some((d) => d.message.includes(releaseRefuses))) { build.ok = true; build.strictReleaseRefusal = releaseRefuses; }
      // Strict release refuses at compile time whatever would fence at run time: a
      // declared native fence's strict-release form is the compile refusal of the
      // same operation (the fence text without its runtime "yet [SC…" tail).
      if (!build.ok && !r.crashed && nativeFence && strictRelease && mode === "release") {
        const core = nativeFence.replace(/\s*(yet\s*)?\[SC\d+.*$/, "").trim();
        if (core && r.diagnostics.some((d) => d.message.includes(core))) { build.ok = true; build.strictReleaseFence = core; }
      }
      if (ice && !(refuse && refuse.includes("internal compiler error"))) { build.ok = false; build.why = "internal compiler error: never an accepted outcome"; }
    } else if (refuse || (releaseRefuses && mode === "release")) {
      build.ok = false;
      build.why = "expected a refusal";
    } else {
      build.bytes = fs.statSync(wasm).size;
      build.output = sha(fs.readFileSync(wasm));
      Object.assign(build, run([runner, wasm], nativeSim ? { SCRIPTC_WASMGC_NATIVE_SIM: "1" } : undefined, path.dirname(file)));
      // Same stdout, the same exact outcome, and (when both fail) the same error.
      build.ok = build.stdout === oracle.stdout && build.outcome === oracle.outcome && (oracle.outcome === "exit:0" || (nativeFence ? build.error.includes(nativeFence) : build.error === oracle.error));
      if (build.ok && mode === "dev" && hitSpecs.length) Object.assign(build, await fastPathHits(wasm, hitSpecs, path.dirname(file)));
    }
    item.builds.push(build);
    if (!build.ok) item.ok = false;
  }
  // A module the backend emitted but its own validator rejected is a compiler bug in every lane, whatever the fixture declares (a
  // known defect, a declared refusal): it is never an accepted outcome.
  if (item.builds.some((b) => b.crashed && (b.diagnostics ?? []).some((d) => /produced an invalid module/.test(d)))) {
    item.ok = false;
    item.builds.unshift({ mode: "all", ok: false, why: "invalid module: never an accepted outcome" });
    item.timing = { compileMs: Math.round(acc.compileMs - acc0.compileMs), runMs: Math.round(acc.runMs - acc0.runMs) };
    return item;
  }
  if (knownDefect) {
    item.knownDefect = knownDefect;
    const signature = parseKnownDefectExpect(src);
    if (signature) {
      // Every build must fail with the signed failure; anything else is a verdict.
      item.knownDefectSignature = signature;
      const verdict = judgeKnownDefect(item.builds, signature);
      item.ok = verdict.ok;
      if (!verdict.ok) item.builds.unshift({ mode: "all", ok: false, why: verdict.why });
    } else {
      // Unsigned (legacy): any failure satisfies it; a pass means the defect is gone (or no longer reached).
      item.knownDefectUnsigned = true;
      item.ok = !item.ok;
      if (!item.ok) item.builds.push({ mode: "all", ok: false, why: `known defect no longer reproduces in the ${lane} lane: remove its @known-defect directive` });
    }
  }
  item.timing = { compileMs: Math.round(acc.compileMs - acc0.compileMs), runMs: Math.round(acc.runMs - acc0.runMs) };
  return item;
}

/** Entry counts of the functions named by `specs` in one instrumented run. */
async function fastPathHits(wasm, specs, cwd) {
  const probe = wasm.replace(/\.wasm$/, ".probe.wasm"), counts = probe + ".counts.json";
  const { bytes, names } = await instrument(fs.readFileSync(wasm), new RegExp(specs.map((r) => `(?:${r})`).join("|")));
  fs.writeFileSync(probe, bytes);
  fs.rmSync(counts, { force: true });
  const t = performance.now();
  const r = spawnSync(process.execPath, ["--import", prelude, "--import", path.join(here, "fnprobe.mjs"), runner, probe], { cwd, encoding: "utf8", timeout: 20000,
    env: { ...process.env, FNPROBE_OUT: counts, FNPROBE_MAP: "" } });
  acc.runMs += performance.now() - t;
  let byName = {};
  try { byName = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(counts, "utf8"))).map(([k, v]) => [names[+k.slice(1)] ?? k, v])); } catch { /* no counts: every spec misses */ }
  const hits = Object.fromEntries(specs.map((re) => [re, Object.entries(byName).filter(([n]) => new RegExp(re).test(n)).reduce((a, [, c]) => a + c, 0)]));
  const missing = specs.filter((re) => !hits[re]);
  return { hits, ...(missing.length ? { ok: false, why: `fast path not taken: ${missing.join(" ; ")}${r.status ? ` (probe run exit ${r.status})` : ""}` } : {}) };
}

const line = (item) => {
  const b = item.builds.find((x) => !x.ok), o = item.oracle;
  if (item.skipped) return `skip ${item.name}  (${/^(native-any-only|native-sim|plain-native-only)/.test(item.skipped) ? "" : "native-only: "}${item.skipped})`;
  if (item.knownDefect && item.ok) return `xfail ${item.name}  (known defect: ${item.knownDefect})`;
  return `${item.ok ? "ok  " : "FAIL"} ${item.name}${b ? `  [${b.mode}] ${b.why ?? b.diagnostics?.[0] ?? `got ${JSON.stringify(b.stdout)} ${b.outcome}${b.error ? ` (${b.error})` : ""} want ${JSON.stringify(o?.stdout)} ${o?.outcome}${o?.error ? ` (${o.error})` : ""}`}` : ""}`;
};

if (worker) {
  // A worker: compile serially against one shared tsgo server; report each
  // fixture as a JSON line for the coordinator.
  process.env.SCRIPTC_SHARE_TS7_HOST = "1";
  const { compile } = await import("../../packages/compiler/dist/index.js");
  for (const name of names) process.stdout.write(`GATE ${JSON.stringify(await check(compile, name))}\n`);
  // A large result line is still in the pipe: let it drain before exiting.
  await new Promise((resolve) => process.stdout.write("", resolve));
  process.exit(0);
}

// Coordinator. Build check: the compiler fingerprint before any dispatch.
const cutBefore = compilerCut();
const buildCheckMs = performance.now() - phaseStart;

// Deal fixtures round-robin to niced workers, stream results.
const lanes = Array.from({ length: Math.min(jobs, names.length) }, (_, i) => names.filter((_, j) => j % jobs === i));
const results = [];
const dispatchStart = performance.now();
await Promise.all(lanes.map((lane) => new Promise((resolve) => {
  const child = spawn("nice", ["-n", "10", process.execPath, fileURLToPath(import.meta.url), "--worker", ...(full ? ["--full"] : []), ...(strictRelease ? ["--strict-release"] : []), ...(production ? ["--production"] : []), ...(nativeSim ? ["--native-sim"] : []), ...(noBatch ? ["--no-batch"] : []), "--dyn", dynModel, ...(nativeAny ? ["--native-any"]:[]), ...(specialize ? ["--specialize", specialize] : []), ...(i31 ? ["--i31"] : []), ...(fuseCasts ? ["--fuse-casts"] : []), ...(inlineSlots !== null ? ["--inline-slots", String(inlineSlots)] : []), ...lane],
    { cwd: here, stdio: ["ignore", "pipe", "pipe"] });
  let buf = "", err = "", done = false, grace;
  // A worker that reports nothing for GATE_STALL_MS (default 10 min) is killed and its unreported fixtures fail: a
  // stalled lane held the gate lock for good (10-29).
  const stallMs = Number(process.env.GATE_STALL_MS ?? 600000);
  const onStall = () => { err += `\nstalled: no fixture reported in ${stallMs / 1000} s`; child.kill("SIGKILL"); };
  let stall = setTimeout(onStall, stallMs);
  child.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!l.startsWith("GATE ")) continue;
      const item = JSON.parse(l.slice(5));
      results.push(item);
      console.log(line(item));
      clearTimeout(stall); stall = setTimeout(onStall, stallMs);
    }
  });
  child.stderr.on("data", (d) => { err += d; });
  const finish = (code) => {
    if (done) return;
    done = true; clearTimeout(stall); clearTimeout(grace);
    // A worker that died mid-lane fails every fixture it did not report.
    for (const name of lane) if (!results.some((r) => r.name === name)) {
      const item = { name, ok: false, builds: [{ mode: "dev", ok: false, why: `worker exited ${code}: ${err.trim().split("\n").pop()}` }] };
      results.push(item);
      console.log(line(item));
    }
    resolve();
  };
  child.on("close", finish);
  // "close" waits for every holder of the worker's pipes, and a process that outlives the worker (the tsgo host
  // inherits its stderr) holds them open for good (10-29: a lane sat idle with its worker gone). The worker's exit,
  // and a moment for its last lines to drain, is enough.
  child.on("exit", (code, signal) => {
    grace = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(code ?? signal); }, 2000);
  });
})));
const wallMs = performance.now() - dispatchStart;

// Build check after execution: the compiler must be the one checked before dispatch.
const cutAfter = compilerCut();
const changed = [];
for (const k of ["compilerBuild", "hostAdapter"]) if (cutBefore[k] !== cutAfter[k]) changed.push(k);
for (const k of Object.keys(cutBefore.provenance)) if (JSON.stringify(cutBefore.provenance[k]) !== JSON.stringify(cutAfter.provenance[k])) changed.push(`provenance.${k}`);

results.sort((a, b) => a.name.localeCompare(b.name));
const failed = results.filter((r) => !r.ok).length;
const provenance = cutBefore.provenance;
const rev = provenance.rev, dirty = provenance.dirty;
const count = {
  passed: results.filter((r) => r.ok && !r.skipped && !r.knownDefect && !r.profile && !r.nativeRefusal).length,
  failed, skipped: results.filter((r) => r.skipped).length,
  knownDefectXfail: results.filter((r) => r.knownDefect && r.ok).length,
  declaredDivergence: results.filter((r) => r.profile).length, nativeRefused: results.filter((r) => r.nativeRefusal).length,
};
const timing = results.reduce((a, r) => ({ compileMs: a.compileMs + (r.timing?.compileMs ?? 0), runMs: a.runMs + (r.timing?.runMs ?? 0) }), { compileMs: 0, runMs: 0 });
const unsuccessful = changed.length ? `compiler changed during the run (${changed.join(", ")}): this result is not the build that was checked before dispatch` : null;
const ok = failed === 0 && !unsuccessful;
const receipt = {
  ok, ...(unsuccessful ? { unsuccessful } : {}),
  profile: "browser", effective, dynModel, experimentalJsSpecialize: specialize ?? null, experimentalTsNativeAny: nativeAny, ...(i31 ? { experimentalDynI31: true } : {}), ...(inlineSlots !== null ? { experimentalDynInlineSlots: inlineSlots } : {}), modes, strictRelease, compiler: rev, dirty, diff: dirty ? provenance.srcDiff : null,
  node: process.version, arch: process.arch, binaryenJs: provenance.binaryenJs, date: new Date().toISOString(),
  // The whole compiler build (not only the WasmGC backend) and the vendored
  // optimizer the backend actually runs. `provenance` is taken before dispatch;
  // `provenanceAfter` after execution (equal unless `unsuccessful` says otherwise).
  provenance, provenanceAfter: cutAfter.provenance,
  inputs: {
    fixtures: fixtureDirs.length === 1 ? dirHash(fixtureDirs[0], (f) => f.endsWith(".ts") || f.endsWith(".js"))
      : sha(fixtureDirs.map((d) => dirHash(d, (f) => f.endsWith(".ts") || f.endsWith(".js"))).join("\n")),
    prelude: sha(fs.readFileSync(prelude, "utf8")), runner: sha(fs.readFileSync(runner, "utf8")),
    gate: sha(fs.readFileSync(fileURLToPath(import.meta.url), "utf8")), fnprobe: sha(fs.readFileSync(path.join(here, "fnprobe.mjs"), "utf8")),
    hostAdapter: cutBefore.hostAdapter, compilerBuild: cutBefore.compilerBuild,
  },
  selection: sortedOnly ?? "all",
  counts: { ...count, total: results.length },
  phases: { buildCheckMs: Math.round(buildCheckMs), compileMs: timing.compileMs, runMs: timing.runMs, dispatchWallMs: Math.round(wallMs), workers: lanes.length, timingNote: "compile and run are summed over workers" },
  passed: results.length - failed, failed, profileDivergences: results.filter((r) => r.profile).map((r) => ({ name: r.name, reason: r.profile })),
  nativeRefusals: results.filter((r) => r.nativeRefusal).map((r) => ({ name: r.name, reason: r.nativeRefusal })),
  nativeOnlySkipped: results.filter((r) => r.skipped).map((r) => ({ name: r.name, reason: r.skipped })),
  knownDefects: results.filter((r) => r.knownDefect).map((r) => ({ name: r.name, reason: r.knownDefect, stillFails: r.ok })), results,
};
const runId = `${Date.now().toString(36)}-${process.pid}`;
const receiptName = `${rev.slice(0, 12)}${dirty ? `-dirty-${provenance.srcDiff}` : ""}-browser${dynModel === "native" ? "-native" : ""}${production ? "-production" : ""}-${full ? (strictRelease ? "full-strict" : "full") : "dev"}${specialize ? "-guarded" : ""}${nativeSim ? "-native-sim" : nativeAny ? "-native-any" : ""}${i31 ? "-i31" : ""}${only.length ? `-partial-${sha(only.join(","))}` : ""}-${runId}.json`;
// The receipt is written first: nothing after this line may delete the only record.
fs.writeFileSync(path.join(reports, receiptName), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
// Cleanup (intermediate probe builds of --hits) runs only after the receipt is on disk.
try { for (const f of fs.readdirSync(out)) if (/\.probe\.wasm(\.counts\.json)?$/.test(f)) fs.rmSync(path.join(out, f), { force: true }); } catch { /* cleanup is best-effort */ }
const divergences = results.filter((r) => r.profile);
const refusals = results.filter((r) => r.nativeRefusal), skipped = results.filter((r) => r.skipped), xfails = results.filter((r) => r.knownDefect && r.ok);
console.log(`\n${results.length - failed}/${results.length} passed (${modes.join("+")})${divergences.length ? `, ${divergences.length} by declared profile divergence (${divergences.map((r) => r.name).join(", ")})` : ""}${refusals.length ? `, ${refusals.length} by declared native refusal (${refusals.map((r) => r.name).join(", ")})` : ""}${skipped.length ? `, ${skipped.length} skipped (${skipped.map((r) => r.name).join(", ")})` : ""}${xfails.length ? `, ${xfails.length} by known defect (${xfails.map((r) => r.name).join(", ")})` : ""}  (receipt ${path.relative(here, path.join(reports, receiptName))})`);
console.log(`profile: ${effective.recipe} (lane ${laneTag}, ${modes.join("+")}, dyn ${dynModel}${nativeAny ? ", native-any" : ""}${production ? ", class arms, wasmgc condition, strict release" : ""})`);
console.log(`counts: passed ${count.passed}, failed ${count.failed}, skipped ${count.skipped}, known-defect xfail ${count.knownDefectXfail}, declared divergence ${count.declaredDivergence}, native refusal ${count.nativeRefused}`);
console.log(`phases (ms, performance.now): build check ${Math.round(buildCheckMs)}, compile ${timing.compileMs} and run ${timing.runMs} (summed over ${lanes.length} worker${lanes.length === 1 ? "" : "s"}), dispatch wall ${Math.round(wallMs)}`);
if (unsuccessful) console.error(`gate: UNSUCCESSFUL: ${unsuccessful}`);
process.exit(ok ? 0 : 1);
