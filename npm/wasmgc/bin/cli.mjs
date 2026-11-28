#!/usr/bin/env node
// The command line: compile TypeScript or JavaScript to a WasmGC module, or compile and run one under this Node.
import fs from "node:fs";
import module from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { format } from "node:util";
import {
  NATIVE_PLATFORMS,
  buildMachinePlatform,
  missingCompanionMessage,
  missingCompanions,
  parseNativeTarget,
  requiredCompanions,
} from "./native.mjs";
import { compile, formatDiagnostic } from "../lib/compile.mjs";
import { unsupportedRuntimeMessage } from "../lib/runtime-check.mjs";

const USAGE = `usage:
  scriptw build <entry.ts> [-o <out>] [--target wasmgc | native | native:<platform>] [--release]
                [--browser] [--conditions <list>] [--compile-packages <list> [--no-native-any]] [--capabilities <list>]
                [--targets <list>]
                [--explain-capabilities]
                [--host auto|<set>|quickjs] [--host-features <list>] [--explain-host] [--host-lib <archive>]
  scriptw run <entry.ts | module.wasm> [--target wasmgc | native] [--release] [--browser] ...

--target wasmgc (the default): build writes <out.wasm> and its host sidecar <out.wasm.host.json>.
--conditions <list> (wasmgc): package export conditions to add to wasmgc, types, import and default,
  comma-separated (for example dom-stream).
--compile-packages <list> (wasmgc): npm packages to compile into the module, comma-separated: their JavaScript
  is compiled with the program rather than loaded as npm JavaScript. A package the compiler cannot take this way
  either stays npm JavaScript (the build says so) or stops the build with its diagnostics. With --browser, the
  program's \`any\` values are then compiled values, as the packages' are; --no-native-any keeps them page values.
--capabilities <list> (wasmgc): auto (the default), baseline or compat, and/or eh=exnref|legacy,
  views=resizable|fixed[:<MiB>], [-]relaxed-simd, threads=off|shared|auto, [-]jspi. auto builds one compat
  variant (<out>.compat.wasm, listed in <out.wasm>.variants.json) only when a target needs it.
--targets <list> (wasmgc): the engines to support, default chrome>=137,firefox>=134,safari>=26.2,node>=24.15.
--explain-capabilities: print the resolved capabilities and why.
--target native: a native executable for this machine. native:<platform> cross-builds for one of
  ${Object.keys(NATIVE_PLATFORMS).join(", ")}; android-arm64 writes <out>/libmain.so.
--browser: a page program (DOM, timers, host: modules) for a web page to load with scriptw/host; natively it
  links the host island and a host. run --browser runs one under Node, which has no DOM.
--host auto (the default): the host pack's smallest set holding the services the program reaches (window,
  gpu, audio, net, rtc; every service when it reads globals by a computed name). --host <set> names one: full
  (generic), ui, headless, offline. --host quickjs links the engine island instead.
--host-features <list>: with auto, services to add (audio) or remove (-rtc), comma-separated.
--explain-host: print the chosen set and why. --host-lib <archive>: your own scr_host_ops() instead of the pack.
run compiles to a temporary directory (or loads a built module) and runs it here.
scriptw --version prints the package and compiler versions and the source commit.`;

// Node's on-disk compile cache (its default directory under the OS temp directory): the compiler is several hundred
// modules, and a cached start skips compiling them again. NODE_DISABLE_COMPILE_CACHE=1 turns it off.
module.enableCompileCache?.();

const argv = process.argv.slice(2);
const command = argv.shift();
if (command === "--version" || command === "-v") {
  const read = (rel) => { try { return JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8")); } catch { return null; } };
  const pkg = read("../package.json");
  // assemble.mjs stamps build-info.json into the package.
  const info = read("../build-info.json");
  const compilerVersion = info?.compiler ?? read("../packages/compiler/package.json")?.version ?? "unknown";
  console.log(`scriptw ${pkg.version}`);
  console.log(`compiler ${compilerVersion}`);
  if (info?.typescript) console.log(`typescript ${info.typescript}`);
  console.log(`commit ${info?.commit ?? "unknown"}`);
  process.exit(0);
}
if (command !== "build" && command !== "run") {
  console.error(USAGE);
  process.exit(command === undefined || command === "--help" || command === "-h" ? 0 : 2);
}

// The modules need WasmGC and JS String Builtins (Node 24); an older engine would fail at the first instantiation.
const unsupported = unsupportedRuntimeMessage();
if (unsupported !== null) {
  console.error(`scriptw: ${unsupported.replace(/^scriptw /, "")}`);
  process.exit(1);
}

let entry, out, release = false, browser = false, host, hostLib, hostFeatures, explainHost = false;
let capabilities, targets, conditions, compilePackages, nativeAny, explainCapabilities = false;
let target = "wasmgc";
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-o" || a === "--out") out = argv[++i];
  else if (a === "--target") {
    target = argv[++i];
    if (target !== "wasmgc" && target !== "native" && !target?.startsWith("native:")) {
      console.error(`scriptw: unsupported target "${target}" (wasmgc, native or native:<platform>)`);
      process.exit(2);
    }
  } else if (a === "--release") release = true;
  else if (a === "--browser") browser = true;
  else if (a === "--host") {
    host = argv[++i];
    if (host === undefined || !/^[a-z][a-z0-9-]*$/.test(host)) {
      console.error(`scriptw: --host takes auto, a host set (full, ui, headless, offline) or quickjs`);
      process.exit(2);
    }
  } else if (a === "--host-features") {
    const list = argv[++i];
    if (list === undefined || !/^[+-]?[a-z]+(,[+-]?[a-z]+)*$/.test(list)) {
      console.error("scriptw: --host-features takes a comma-separated list of services, each name or -name");
      process.exit(2);
    }
    hostFeatures = list.split(",");
  } else if (a === "--explain-host") explainHost = true;
  else if (a === "--conditions") {
    const list = argv[++i];
    if (list === undefined || !/^[A-Za-z0-9_.-]+(,[A-Za-z0-9_.-]+)*$/.test(list)) { console.error("scriptw: --conditions takes a comma-separated list of condition names"); process.exit(2); }
    conditions = list.split(",");
  } else if (a === "--compile-packages") {
    const list = argv[++i];
    if (list === undefined || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(,(@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/.test(list)) { console.error("scriptw: --compile-packages takes a comma-separated list of npm package names"); process.exit(2); }
    compilePackages = list.split(",");
  } else if (a === "--no-native-any") nativeAny = false;
  else if (a === "--capabilities" || a === "--targets") {
    const list = argv[++i];
    if (list === undefined || list.startsWith("--")) { console.error(`scriptw: ${a} takes a comma-separated list`); process.exit(2); }
    if (a === "--capabilities") capabilities = list; else targets = list;
  } else if (a === "--explain-capabilities") explainCapabilities = true;
  else if (a === "--host-lib") hostLib = path.resolve(argv[++i]);
  else if (a.startsWith("-")) { console.error(`scriptw: unknown option ${a}\n${USAGE}`); process.exit(2); }
  else if (entry === undefined) entry = a;
  else { console.error(`scriptw: unexpected argument ${a}`); process.exit(2); }
}
if (entry === undefined) { console.error(USAGE); process.exit(2); }
entry = path.resolve(entry);
if (!fs.existsSync(entry)) { console.error(`scriptw: ${entry} does not exist`); process.exit(2); }

const compilerDist = new URL("../packages/compiler/dist/", import.meta.url);

async function build(source, outPath) {
  const r = await compile(source, { outPath, release, browser, ...(conditions === undefined ? {} : { conditions }), ...(compilePackages === undefined ? {} : { compilePackages }), ...(nativeAny === undefined ? {} : { nativeAny }), ...(capabilities === undefined ? {} : { capabilities }), ...(targets === undefined ? {} : { targets }) });
  if (!r.ok) {
    for (const d of r.diagnostics) console.error(formatDiagnostic(d));
    process.exit(1);
  }
  if (explainCapabilities) for (const line of r.explainCapabilities) console.error(`scriptw: capabilities: ${line}`);
  return r;
}

/** Node 24 and 25 carry WebAssembly.Memory.prototype.toResizableBuffer behind a V8 flag (shipped in Node 26), which
 * NODE_OPTIONS refuses and v8.setFlagsFromString applies only to new contexts: a module that needs it reruns this
 * command in a Node started with the flag. */
const RAB_FLAG = "--experimental-wasm-rab-integration";
const rabFlagAvailable = () => { const major = Number(process.versions.node.split(".")[0]); return major === 24 || major === 25; };

async function run(wasmPath) {
  const host = await import(new URL("backend/wasmgc/host.js", compilerDist));
  const { instantiateWasmGc, chooseVariant, requiredCapabilities, detectCapabilities } = host;
  const caps = detectCapabilities();
  const required = requiredCapabilities(new Uint8Array(fs.readFileSync(wasmPath)));
  if (required?.requires.includes("resizable-memory-buffer") && !caps["resizable-memory-buffer"] && rabFlagAvailable()
    && !process.execArgv.includes(RAB_FLAG) && process.env.SCRIPTW_RAB_RERUN !== "1") {
    const r = spawnSync(process.execPath, [RAB_FLAG, ...process.execArgv, process.argv[1], "run", wasmPath], { stdio: "inherit", env: { ...process.env, SCRIPTW_RAB_RERUN: "1" } });
    process.exitCode = r.status ?? 1;
    return;
  }
  // A variant set beside the module: the first variant this engine runs.
  const setPath = `${wasmPath}.variants.json`;
  if (fs.existsSync(setPath)) wasmPath = path.join(path.dirname(wasmPath), chooseVariant(JSON.parse(fs.readFileSync(setPath, "utf8")), caps).file);
  const bytes = fs.readFileSync(wasmPath);
  let uncaught = null;
  const m = await instantiateWasmGc(bytes, {
    log: (...v) => process.stdout.write(format(...v) + "\n"),
    error: (...v) => process.stderr.write(format(...v) + "\n"),
    onUncaught: (e) => { uncaught ??= e; },
  });
  let failed = false;
  try {
    const done = m.main();
    if (done && typeof done.then === "function") await done.then(undefined, (e) => { uncaught ??= e; });
    // Settle as Node's loop would: wait while referenced timers remain, then two quiet turns, which let an unhandled
    // rejection's report (a zero-delay timer scheduled from a microtask drain) fire.
    for (let quiet = 0; uncaught === null && quiet < 2;) {
      const pending = m.pendingTimers() > 0;
      await new Promise((r) => setTimeout(r, pending ? 2 : 0));
      quiet = pending || m.pendingTimers() > 0 ? 0 : quiet + 1;
    }
  } catch (e) {
    uncaught ??= e;
  } finally {
    m.stopTimers?.();
  }
  if (uncaught !== null) {
    failed = true;
    process.stderr.write(uncaughtText(m, uncaught) + "\n");
  }
  process.exitCode = failed ? 1 : process.exitCode ?? 0;
}

/** An exception that escaped the program, as text: a compiled exception's own text (the module's exnText export), else
 * a JavaScript error's stack. */
function uncaughtText(m, e) {
  const ex = m.instance.exports;
  if (e instanceof WebAssembly.Exception) {
    if (ex.exn && ex.exnText && e.is(ex.exn)) {
      try { return `Uncaught ${String(ex.exnText(e.getArg(ex.exn, 0)))}`; } catch { /* the generic text below */ }
    }
    return "Uncaught exception thrown by the program";
  }
  try {
    return String(e?.stack ?? e);
  } catch {
    // A compiled value (a rejection reason that is a GC struct) has no JavaScript string conversion.
    try { return `Uncaught ${String(ex.exnText(e))}`; } catch { return "Uncaught exception thrown by the program"; }
  }
}

/** A native build: the compiler's executable lane with the target's companions (native.mjs). */
async function buildNative(source, outPath, platform) {
  const machine = buildMachinePlatform();
  if (machine === null) {
    console.error(`scriptw: no native build exists for this machine (${process.platform} ${process.arch})`);
    process.exit(2);
  }
  const missing = missingCompanions(requiredCompanions(machine, platform, { browser, host, hostLib }), compilerDist);
  if (missing.length > 0) {
    console.error(missingCompanionMessage(missing, platform, machine));
    process.exit(1);
  }
  if (platform !== machine) process.env.SCRIPTC_TARGET = NATIVE_PLATFORMS[platform].triple;
  const { compile } = await import(new URL("index.js", compilerDist));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const r = await compile(source, {
    outDir: path.dirname(outPath),
    outPath,
    outputKind: "exe",
    backend: "llvm",
    // As for WasmGC: a package's `wasmgc` export is its source for compiled builds (scriptw/int and the other intrinsic
    // libraries ship their TypeScript there), whichever backend compiles it.
    conditions: ["wasmgc", ...(conditions ?? []).filter((c) => c !== "wasmgc")],
    ...(release ? {} : { optimization: "dev" }),
    ...(browser ? { browser: true } : {}),
    ...(host === undefined ? {} : { host }),
    ...(hostFeatures === undefined ? {} : { hostFeatures }),
    ...(explainHost ? { explainHost: true } : {}),
    ...(hostLib === undefined ? {} : { hostLib }),
    ...(platform === "android-arm64" ? { nativeOutput: "android-main" } : {}),
  });
  if (!r.ok) {
    for (const d of r.diagnostics) {
      console.error(d.loc?.file ? `${d.loc.file}: ${d.code}: ${d.message}` : `${d.code}: ${d.message}`);
      if (d.hint) console.error(`  hint: ${d.hint}`);
    }
    process.exit(1);
  }
  return r.binaryPath;
}

const nativeTarget = target === "wasmgc" ? null : parseNativeTarget(target, buildMachinePlatform());
if (nativeTarget?.error) {
  console.error(`scriptw: ${nativeTarget.error}`);
  process.exit(2);
}
if (nativeTarget !== null && (capabilities !== undefined || targets !== undefined || explainCapabilities || compilePackages !== undefined)) {
  console.error("scriptw: --capabilities, --targets, --explain-capabilities and --compile-packages apply to --target wasmgc");
  process.exit(2);
}
if (nativeTarget === null && (host !== undefined || hostLib !== undefined || hostFeatures !== undefined || explainHost)) {
  console.error("scriptw: --host, --host-features, --explain-host and --host-lib apply to --target native");
  process.exit(2);
}

if (nativeTarget !== null) {
  const platform = nativeTarget.platform;
  const stem = entry.replace(/\.(m|c)?[jt]sx?$/, "");
  const defaultOut =
    platform === "android-arm64" ? path.join(stem, "libmain.so") : stem + (NATIVE_PLATFORMS[platform].os === "win32" ? ".exe" : "");
  if (command === "build") {
    const written = await buildNative(entry, path.resolve(out ?? defaultOut), platform);
    console.error(`scriptw: wrote ${path.relative(process.cwd(), written) || written}`);
  } else {
    if (platform !== buildMachinePlatform()) {
      console.error(`scriptw: run builds for this machine; use build to cross-build for ${platform}`);
      process.exit(2);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scriptw-native-"));
    try {
      const binary = await buildNative(entry, path.join(dir, path.basename(defaultOut)), platform);
      const r = spawnSync(binary, [], { stdio: "inherit" });
      process.exitCode = r.status ?? 1;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
} else if (command === "build") {
  const target = path.resolve(out ?? entry.replace(/\.(m|c)?[jt]sx?$/, "") + ".wasm");
  const built = await build(entry, target);
  for (const v of built.variants) console.error(`scriptw: wrote ${path.relative(process.cwd(), v.wasmPath) || v.wasmPath}`);
} else if (entry.endsWith(".wasm")) {
  await run(entry);
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wasmgc-run-"));
  try {
    await run((await build(entry, path.join(dir, "main.wasm"))).wasmPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
