// `--target native` and `--target native:<platform>`: which companions a native build needs, and whether they are
// installed. A native build takes three per-platform companions beside scriptw:
//
// - the LLVM helper, `@scriptw/llvm-<build machine>`: it runs on the machine that builds, so a target needs a helper
//   only for the machines it is built from (Android is built from the other four, and has none of its own);
// - the runtime pack, `@scriptw/runtime-<target>`: link inputs for the target;
// - the host pack, `@scriptw/host-<target>`: the host a page program (`--browser`) links, unless --host-lib names an
//   archive or --host=quickjs keeps the engine island.
//
// Each resolves from a directory in SCRIPTW_LLVM_PACK, SCRIPTW_RUNTIME_PACK or SCRIPTW_HOST_PACK first, then as the
// `@scriptw/*` package; the helper and runtime pack also resolve as upstream's `@scriptc/*` package (the compiler's
// scriptw-packages.ts), which has no host pack.
import { createRequire } from "node:module";

/** The fork's native platforms. `triple` is the compiler's SCRIPTC_TARGET spelling, `buildMachine` whether scriptw
 * runs there, and `upstream` the platform suffix of upstream's package names. */
export const NATIVE_PLATFORMS = {
  "linux-x64-gnu": { os: "linux", cpu: "x64", triple: "x86_64-linux-gnu", buildMachine: true, upstream: "linux-x64-gnu" },
  "win32-x64": { os: "win32", cpu: "x64", triple: "x86_64-windows-gnu", buildMachine: true, upstream: "win32-x64-msvc" },
  "darwin-arm64": { os: "darwin", cpu: "arm64", triple: "aarch64-macos", buildMachine: true, upstream: "darwin-arm64" },
  "darwin-x64": { os: "darwin", cpu: "x64", triple: "x86_64-macos", buildMachine: true, upstream: "darwin-x64" },
  "android-arm64": { os: "android", cpu: "arm64", triple: "aarch64-linux-android", buildMachine: false, upstream: "android-arm64" },
};

/** The platform scriptw is running on, or null when the fork has no native build for it. */
export function buildMachinePlatform(platform = process.platform, arch = process.arch, report = process.report) {
  if (platform === "linux") {
    const glibc = typeof report?.getReport?.()?.header?.glibcVersionRuntime === "string";
    return arch === "x64" && glibc ? "linux-x64-gnu" : null;
  }
  if (platform === "win32") return arch === "x64" ? "win32-x64" : null;
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : arch === "x64" ? "darwin-x64" : null;
  return null;
}

/** `native` or `native:<platform>` as a target platform, or an error message. */
export function parseNativeTarget(spelling, machine) {
  if (spelling === "native") {
    if (machine === null) return { error: `no native build exists for this machine (${process.platform} ${process.arch})` };
    return { platform: machine };
  }
  const platform = spelling.slice("native:".length);
  if (!(platform in NATIVE_PLATFORMS)) {
    return { error: `unknown native platform "${platform}" (one of ${Object.keys(NATIVE_PLATFORMS).join(", ")})` };
  }
  return { platform };
}

/** The companions a native build of `target` from `machine` needs. */
export function requiredCompanions(machine, target, { browser = false, host, hostLib } = {}) {
  const needs = [
    {
      family: "LLVM helper",
      name: `@scriptw/llvm-${machine}`,
      upstream: `@scriptc/llvm-${NATIVE_PLATFORMS[machine].upstream}`,
      env: "SCRIPTW_LLVM_PACK",
    },
    {
      family: "runtime pack",
      name: `@scriptw/runtime-${target}`,
      upstream: `@scriptc/runtime-${NATIVE_PLATFORMS[target].upstream}`,
      env: "SCRIPTW_RUNTIME_PACK",
    },
  ];
  if (browser && host !== "quickjs" && hostLib === undefined && !process.env.SCRIPTC_HOST_LIB) {
    needs.push({ family: "host pack", name: `@scriptw/host-${target}`, upstream: null, env: "SCRIPTW_HOST_PACK" });
  }
  return needs;
}

/** The companions of `needs` that resolve from none of their places, as resolved from `from` (the compiler's dist). */
export function missingCompanions(needs, from, env = process.env) {
  const req = createRequire(from);
  const resolves = (name) => {
    try {
      req.resolve(`${name}/package.json`);
      return true;
    } catch {
      return false;
    }
  };
  return needs.filter(
    (need) => !(env[need.env] || resolves(need.name) || (need.upstream !== null && resolves(need.upstream))),
  );
}

/** The diagnostic for missing companions: each package, what it is for, and how to supply it. */
export function missingCompanionMessage(missing, target, machine) {
  const lines = [`scriptw: a native build for ${target} needs packages that are not installed:`];
  for (const need of missing) lines.push(`  ${need.name} (the ${need.family}; or set ${need.env} to its directory)`);
  const cross = target !== machine;
  lines.push(
    cross
      ? `A cross build installs the target's packages explicitly: npm install --force ${missing.map((n) => n.name).join(" ")}`
      : "They are optional dependencies of scriptw: reinstall it without --omit=optional.",
  );
  return lines.join("\n");
}
