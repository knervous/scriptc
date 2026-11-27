#!/usr/bin/env node
// The command line: compile TypeScript or JavaScript to a WasmGC module, or compile and run one under this Node.
import fs from "node:fs";
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

const USAGE = `usage:
  scriptw build <entry.ts> [-o <out>] [--target wasmgc | native | native:<platform>] [--release]
                [--browser] [--host auto|<set>|quickjs] [--host-features <list>] [--explain-host]
                [--host-lib <archive>]
  scriptw run <entry.ts | module.wasm> [--target wasmgc | native] [--release] [--browser] ...

--target wasmgc (the default): build writes <out.wasm> and its host sidecar <out.wasm.host.json>.
--target native: a native executable for this machine. native:<platform> cross-builds for one of
  ${Object.keys(NATIVE_PLATFORMS).join(", ")}; android-arm64 writes <out>/libmain.so.
--browser: a page program (DOM, timers, host: modules); natively it links the host island and a host.
--host auto (the default): the host pack's smallest set holding the services the program reaches (window,
  gpu, audio, net, rtc; every service when it reads globals by a computed name). --host <set> names one: full
  (generic), ui, headless, offline. --host quickjs links the engine island instead.
--host-features <list>: with auto, services to add (audio) or remove (-rtc), comma-separated.
--explain-host: print the chosen set and why. --host-lib <archive>: your own scr_host_ops() instead of the pack.
run compiles to a temporary directory (or loads a built module) and runs it here.`;

const argv = process.argv.slice(2);
const command = argv.shift();
if (command === "--version" || command === "-v") {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}
if (command !== "build" && command !== "run") {
  console.error(USAGE);
  process.exit(command === undefined || command === "--help" || command === "-h" ? 0 : 2);
}

let entry, out, release = false, browser = false, host, hostLib, hostFeatures, explainHost = false;
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
  const { compile } = await import(new URL("index.js", compilerDist));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const r = await compile(source, { outDir: path.dirname(outPath), outPath, outputKind: "wasmgc", release });
  if (!r.ok) {
    for (const d of r.diagnostics) console.error(d.file ? `${d.file}${d.line ? `:${d.line}` : ""}: ${d.message}` : d.message);
    process.exit(1);
  }
  return outPath;
}

async function run(wasmPath) {
  const { instantiateWasmGc } = await import(new URL("backend/wasmgc/host.js", compilerDist));
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
    await new Promise((r) => setTimeout(r, 0));
    while (uncaught === null && m.pendingTimers() > 0) await new Promise((r) => setTimeout(r, 2));
  } catch (e) {
    uncaught ??= e;
  } finally {
    m.stopTimers?.();
  }
  if (uncaught !== null) {
    failed = true;
    const shown = uncaught instanceof WebAssembly.Exception ? "Uncaught exception thrown by the program" : uncaught?.stack ?? String(uncaught);
    process.stderr.write(shown + "\n");
  }
  process.exitCode = failed ? 1 : process.exitCode ?? 0;
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
  await build(entry, target);
  console.error(`scriptw: wrote ${path.relative(process.cwd(), target) || target}`);
} else if (entry.endsWith(".wasm")) {
  await run(entry);
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wasmgc-run-"));
  try {
    await run(await build(entry, path.join(dir, "main.wasm")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
