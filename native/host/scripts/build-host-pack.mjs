#!/usr/bin/env node
// Builds a host pack directory: one archive of the generic host per feature set, side by side, and the pack's
// host-pack.json (packages/compiler/src/backend/host-island.ts, schema scriptw.host-pack.v2).
//
//   node native/host/scripts/build-host-pack.mjs --out <dir> [--target <rust triple>] [--sets full,ui,headless,offline]
//
// The sets, as cargo features of scriptc-host, and the host services each holds (the compiler's host-features.ts
// picks the smallest set holding what a program reaches):
//   full      the defaults: window, gpu, audio, net, rtc               artifacts/libscriptc_host.a
//   ui        default-entry,window,net: window, gpu, net               artifacts/libscriptc_host_ui.a
//   headless  default-entry,net: net                                   artifacts/libscriptc_host_headless.a
//   offline   default-entry: none (the document, timers, storage)      artifacts/libscriptc_host_offline.a
// Each platform's default sets: Linux full, headless, offline (its window builds nothing, so ui would be headless
// with the GPU); Windows and macOS all four; Android full and ui (its host starts from the window's Activity).
//
// linkArgs is one list for every archive the pack holds: the full set's `native-static-libs` (rustc's own order),
// then each other set's libraries the list does not have yet. On Android, `exports` lists the archive's entry points
// the platform calls (JNI_OnLoad, Java_*), and every archive must define each of them, since the link roots them.
//
// Cross targets take their C toolchain from the caller's environment, as cargo does: CC_<target>, CXX_<target>,
// AR_<target> and CARGO_TARGET_<TARGET>_LINKER (the NDK's clang for Android, with ANDROID_SYSROOT, ANDROID_API and
// glslangValidator). x86_64-pc-windows-gnullvm sets them itself unless the caller did: Zig (ZIG, else PATH) through
// zig-wrapper.rs, compiled into target/zig-wrapper with zig-mingw-shims.o (windowsGnullvmEnv). llvm-nm comes from
// LLVM_NM, else PATH.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(hostRoot, "../..");

export const HOST_SETS = {
  full: { features: null, file: "libscriptc_host.a", services: ["window", "gpu", "audio", "net", "rtc"] },
  ui: { features: ["default-entry", "window", "net"], file: "libscriptc_host_ui.a", services: ["window", "gpu", "net"] },
  headless: { features: ["default-entry", "net"], file: "libscriptc_host_headless.a", services: ["net"] },
  offline: { features: ["default-entry"], file: "libscriptc_host_offline.a", services: [] },
};

/** The sets a target's pack ships by default. */
export function defaultSets(target) {
  if (target.includes("android")) return ["full", "ui"];
  if (target.includes("linux")) return ["full", "headless", "offline"];
  return ["full", "ui", "headless", "offline"];
}

/** cargo's feature arguments for a set. */
export function setFeatureArgs(name) {
  const set = HOST_SETS[name];
  if (set === undefined) throw new Error(`unknown host set ${name} (known: ${Object.keys(HOST_SETS).join(", ")})`);
  return set.features === null ? [] : ["--no-default-features", "--features", set.features.join(",")];
}

/** The libraries of rustc's `note: native-static-libs: ...` line. */
export function parseNativeStaticLibs(output) {
  const line = output.split("\n").find((l) => l.includes("native-static-libs:"));
  if (line === undefined) throw new Error("rustc printed no native-static-libs line");
  return line.slice(line.indexOf("native-static-libs:") + "native-static-libs:".length).trim().split(/\s+/).filter(Boolean);
}

/** One linkArgs list for several archives: the first list as rustc printed it, then each later list's entries it
 * does not have yet, in their order. */
export function unionLinkArgs(lists) {
  const out = [...(lists[0] ?? [])];
  for (const list of lists.slice(1)) for (const arg of list) if (!out.includes(arg)) out.push(arg);
  return out;
}

function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  return /^host: (\S+)$/m.exec(out)[1];
}

function hostAbi() {
  const header = readFileSync(join(repoRoot, "packages/runtime/src/scr_host_island.h"), "utf8");
  const m = /^#define SCR_HOST_ABI (\d+)$/m.exec(header);
  if (m === null) throw new Error("scr_host_island.h defines no SCR_HOST_ABI");
  return Number(m[1]);
}

/** The archive's defined text symbols (llvm-nm --defined-only). */
function definedText(archive) {
  const out = execFileSync(process.env.LLVM_NM ?? "llvm-nm", ["--defined-only", archive], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const names = new Set();
  for (const line of out.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3 && parts[1] === "T") names.add(parts[2]);
  }
  return names;
}

function cargo(args, env) {
  execFileSync("cargo", args, { cwd: hostRoot, env, stdio: ["ignore", "inherit", "inherit"] });
}

export const WINDOWS_GNULLVM = "x86_64-pc-windows-gnullvm";

/** The environment cargo needs to build for x86_64-pc-windows-gnullvm with Zig: the wrappers (zig-wrapper.rs, as
 * zig-cc, zig-c++ and zig-ar) as the target's CC, CXX, AR and linker, and zig-mingw-shims.o for a dependency's own
 * link. Both are built into `tools` when their source is newer. A caller's CC_x86_64_pc_windows_gnullvm wins. */
export function windowsGnullvmEnv(env = process.env, tools = join(hostRoot, "target", "zig-wrapper")) {
  const t = WINDOWS_GNULLVM.replaceAll("-", "_");
  if (env[`CC_${t}`]) return env;
  const zig = env.ZIG ?? "zig";
  const exe = process.platform === "win32" ? ".exe" : "";
  const wrapper = (tool) => join(tools, `zig-${tool}${exe}`);
  const newer = (out, source) => !existsSync(out) || statSync(out).mtimeMs < statSync(source).mtimeMs;
  mkdirSync(tools, { recursive: true });
  const wrapperSource = join(hostRoot, "scripts", "zig-wrapper.rs");
  if (newer(wrapper("cc"), wrapperSource)) {
    execFileSync("rustc", ["-O", "--edition", "2024", wrapperSource, "-o", wrapper("cc")], { stdio: "inherit" });
    for (const tool of ["c++", "ar"]) copyFileSync(wrapper("cc"), wrapper(tool));
  }
  const shimsSource = join(hostRoot, "scripts", "zig-mingw-shims.c");
  const shims = join(tools, "zig-mingw-shims.o");
  if (newer(shims, shimsSource)) {
    execFileSync(zig, ["cc", "-target", "x86_64-windows-gnu", "-O2", "-fno-builtin", "-c", shimsSource, "-o", shims], { stdio: "inherit" });
  }
  return {
    ...env,
    ZIG_WRAPPER_ZIG: zig,
    ZIG_WRAPPER_TARGET: "x86_64-windows-gnu",
    ZIG_WRAPPER_LINK_EXTRA: shims,
    [`CC_${t}`]: wrapper("cc"),
    [`CXX_${t}`]: wrapper("c++"),
    [`AR_${t}`]: wrapper("ar"),
    [`CARGO_TARGET_${t.toUpperCase()}_LINKER`]: wrapper("cc"),
  };
}

function main() {
  const { values } = parseArgs({
    options: { out: { type: "string" }, target: { type: "string" }, sets: { type: "string" } },
  });
  if (values.out === undefined) throw new Error("--out <dir> is required");
  const target = values.target ?? hostTriple();
  const native = target === hostTriple();
  const sets = values.sets === undefined ? defaultSets(target) : values.sets.split(",").map((s) => s.trim()).filter(Boolean);
  if (!sets.includes("full")) throw new Error("a host pack needs the full set: the one a program the compiler cannot read takes");
  const out = resolve(values.out);
  const env = target === WINDOWS_GNULLVM ? windowsGnullvmEnv() : process.env;
  mkdirSync(join(out, "artifacts"), { recursive: true });
  const built = [];
  for (const name of sets) {
    const features = setFeatureArgs(name);
    // The build machine's own target builds without --target, into target/release (where the host-island lane looks).
    const common = ["--release", "--locked", "-p", "scriptc-host", ...(native ? [] : ["--target", target]), ...features];
    cargo(["build", ...common], env);
    // The link libraries: rustc prints them (on cargo's stderr) for a staticlib crate type only.
    const printed = spawnSync(
      "cargo",
      ["rustc", ...common, "--lib", "--crate-type", "staticlib", "--", "--print=native-static-libs"],
      { cwd: hostRoot, env, encoding: "utf8", maxBuffer: 1 << 26 },
    );
    if (printed.status !== 0) throw new Error(`cargo rustc failed for the ${name} set:\n${printed.stderr}`);
    const libs = parseNativeStaticLibs(`${printed.stdout}\n${printed.stderr}`);
    const archive = join(out, "artifacts", HOST_SETS[name].file);
    copyFileSync(join(hostRoot, "target", ...(native ? [] : [target]), "release", "libscriptc_host.a"), archive);
    const symbols = definedText(archive);
    if (!symbols.has("scr_host_ops")) throw new Error(`${HOST_SETS[name].file} does not define scr_host_ops`);
    built.push({ name, archive, libs, symbols });
  }
  const exports = target.includes("android")
    ? [...built[0].symbols].filter((s) => s === "JNI_OnLoad" || s.startsWith("Java_")).sort()
    : [];
  for (const b of built) {
    const missing = exports.filter((s) => !b.symbols.has(s));
    if (missing.length > 0) throw new Error(`${HOST_SETS[b.name].file} lacks the entry points ${missing.join(", ")}`);
  }
  const packSets = {};
  for (const b of built) {
    packSets[b.name] = {
      path: `artifacts/${HOST_SETS[b.name].file}`,
      sha256: createHash("sha256").update(readFileSync(b.archive)).digest("hex"),
      services: HOST_SETS[b.name].services,
    };
  }
  const manifest = {
    schema: "scriptw.host-pack.v2",
    abi: hostAbi(),
    target,
    sets: packSets,
    linkArgs: unionLinkArgs(built.map((b) => b.libs)),
    ...(exports.length > 0 ? { exports } : {}),
  };
  writeFileSync(join(out, "host-pack.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const b of built) process.stdout.write(`${b.name}: ${b.archive} (${b.libs.join(" ")})\n`);
  process.stdout.write(`wrote ${join(out, "host-pack.json")}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
