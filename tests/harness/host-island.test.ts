// The host island's native link (packages/compiler/src/backend/host-island.ts): a program that reaches an embedding
// host links the host island and one archive defining scr_host_ops(), found in a host pack or named by --host-lib.
// Until the generic host lands, the archive is the stub host (tests/fixtures/host-island/stub-host.c); the
// differential lane against the generic host joins these once both are on one branch.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { compile } from "@scriptc/compiler";

const repo = join(import.meta.dirname, "../..");
const fixtures = join(repo, "tests/fixtures/host-island");
const runtimeSrc = join(repo, "packages/runtime/src");
const hostAbi = Number(/#define\s+SCR_HOST_ABI\s+(\d+)/.exec(readFileSync(join(runtimeSrc, "scr_host_island.h"), "utf8"))![1]);
// The host packs' platforms this lane runs on: the pack linking needs the target's runtime pack with the host island.
const supported = process.platform === "linux" && process.arch === "x64" && process.env["SCRIPTC_SAN"] !== "1";

let work: string;
let stubArchive: string;

function hostPack(dir: string, overrides: Record<string, unknown> = {}): string {
  mkdirSync(join(dir, "artifacts"), { recursive: true });
  copyFileSync(stubArchive, join(dir, "artifacts/libscriptc_host.a"));
  const sha256 = createHash("sha256").update(readFileSync(stubArchive)).digest("hex");
  writeFileSync(
    join(dir, "host-pack.json"),
    JSON.stringify({
      schema: "scriptw.host-pack.v1",
      abi: hostAbi,
      target: "x86_64-unknown-linux-gnu",
      archives: { generic: { path: "artifacts/libscriptc_host.a", sha256 } },
      linkArgs: [],
      ...overrides,
    }),
  );
  return dir;
}

/** A v2 host pack whose sets all hold the stub host (each its own copy), with the services the set names. */
function hostPackV2(dir: string, sets: Record<string, string[]>, extra: Record<string, unknown> = {}): string {
  mkdirSync(join(dir, "artifacts"), { recursive: true });
  const entries: Record<string, unknown> = {};
  for (const [name, services] of Object.entries(sets)) {
    const path = `artifacts/libscriptc_host_${name}.a`;
    copyFileSync(stubArchive, join(dir, path));
    entries[name] = { path, sha256: createHash("sha256").update(readFileSync(stubArchive)).digest("hex"), services };
  }
  writeFileSync(join(dir, "host-pack.json"), JSON.stringify({ schema: "scriptw.host-pack.v2", abi: hostAbi, target: "x86_64-unknown-linux-gnu", sets: entries, linkArgs: [], ...extra }));
  return dir;
}

const LINUX_SETS = { full: ["window", "gpu", "audio", "net", "rtc"], headless: ["net"], offline: [] };

/** A build's --explain-host line (compile() writes it on this process's stderr). */
async function explained(build: () => Promise<unknown>): Promise<{ result: Awaited<ReturnType<typeof compile>>; lines: string[] }> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    const text = String(chunk);
    if (text.startsWith("host set ")) lines.push(text.trim());
    return true;
  });
  try {
    return { result: (await build()) as Awaited<ReturnType<typeof compile>>, lines };
  } finally {
    spy.mockRestore();
  }
}

const savedEnv = { ...process.env };
afterEach(() => {
  for (const name of ["SCRIPTW_HOST_PACK", "SCRIPTC_HOST_LIB", "SCRIPTC_HOST_LINK_ARGS", "SCRIPTC_HOST_FEATURES", "SCRIPTC_EXPLAIN_HOST"]) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

async function build(name: string, options: Record<string, unknown> = {}) {
  const outDir = mkdtempSync(join(work, `${name}-`));
  const entry = join(outDir, `${name}.ts`);
  copyFileSync(join(fixtures, `${name}.ts`), entry);
  copyFileSync(join(fixtures, `${name}.d.ts`), join(outDir, `${name}.d.ts`));
  return compile(entry, { backend: "llvm", browser: true, outDir, outPath: join(outDir, name), ...options } as never);
}

function run(binary: string): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(binary, [], { encoding: "utf8", timeout: 10_000 });
  expect(r.error).toBeUndefined();
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

describe.skipIf(!supported)("host island link", () => {
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "scriptc-host-island-"));
    const object = join(work, "stub-host.o");
    stubArchive = join(work, "libstub_host.a");
    execFileSync("clang", ["-std=c11", "-O1", "-fPIC", "-Wall", "-Werror", "-I", runtimeSrc, "-c", join(fixtures, "stub-host.c"), "-o", object]);
    execFileSync("ar", ["rcs", stubArchive, object]);
  });

  test("a host: module program links the host pack's archive and runs against it", async () => {
    process.env["SCRIPTW_HOST_PACK"] = hostPack(join(work, "pack"));
    const result = await build("host-demo");
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    const r = run(result.binaryPath);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(readFileSync(join(fixtures, "host-demo.expected"), "utf8"));
  });

  test("hostLib links an embedder's archive in place of the host pack", async () => {
    const result = await build("host-demo", { hostLib: stubArchive });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    expect(run(result.binaryPath).stdout).toBe(readFileSync(join(fixtures, "host-demo.expected"), "utf8"));
  });

  test("SCRIPTC_HOST_LIB names the embedder's archive too", async () => {
    process.env["SCRIPTC_HOST_LIB"] = stubArchive;
    const result = await build("host-demo");
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    expect(run(result.binaryPath).stdout).toBe(readFileSync(join(fixtures, "host-demo.expected"), "utf8"));
  });

  test("a missing host pack is a diagnostic that names the package", async () => {
    const result = await build("host-demo");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]!.code).toBe("SC3003");
    expect(result.diagnostics[0]!.message).toContain("@scriptw/host-linux-x64-gnu");
    expect(result.diagnostics[0]!.hint).toContain("--host-lib");
  });

  test("a host pack of another ABI is refused before the link", async () => {
    process.env["SCRIPTW_HOST_PACK"] = hostPack(join(work, "pack-old"), { abi: hostAbi - 1 });
    const result = await build("host-demo");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]!.message).toContain(`host ABI ${hostAbi - 1}`);
  });

  test("a host pack whose archive changed is refused", async () => {
    const dir = hostPack(join(work, "pack-changed"));
    writeFileSync(join(dir, "artifacts/libscriptc_host.a"), "not the archive the manifest names");
    process.env["SCRIPTW_HOST_PACK"] = dir;
    const result = await build("host-demo");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]!.message).toContain("hash mismatch");
  });

  test("the headless choice needs the pack's headless archive", async () => {
    process.env["SCRIPTW_HOST_PACK"] = hostPack(join(work, "pack-no-headless"));
    const result = await build("host-demo", { host: "headless" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]!.message).toContain("no headless archive");
  });

  test("auto takes the pack's smallest set that holds what the program reaches", async () => {
    // host-demo reaches no page service, only its typed module: the set follows what the pack says the module needs.
    const modules = { "host:demo": [] as string[], demo: [] as string[] };
    process.env["SCRIPTW_HOST_PACK"] = hostPackV2(join(work, "pack-v2"), LINUX_SETS, { modules });
    const { result, lines } = await explained(() => build("host-demo", { explainHost: true }));
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^host set offline \(no service\): no host service reached$/);
    expect(run(result.binaryPath).stdout).toBe(readFileSync(join(fixtures, "host-demo.expected"), "utf8"));

    const added = await explained(() => build("host-demo", { explainHost: true, hostFeatures: ["net"] }));
    expect(added.result.ok).toBe(true);
    expect(added.lines[0]).toBe("host set headless (net): net: --host-features");

    // A module the pack does not describe needs every service.
    process.env["SCRIPTW_HOST_PACK"] = hostPackV2(join(work, "pack-v2-bare"), LINUX_SETS);
    const bare = await explained(() => build("host-demo", { explainHost: true }));
    expect(bare.result.ok).toBe(true);
    expect(bare.lines[0]).toMatch(/^host set full \(window, gpu, audio, net, rtc\): every service: host module (host:)?demo, which the pack does not describe/);

    const named = await explained(() => build("host-demo", { explainHost: true, host: "headless" }));
    expect(named.result.ok).toBe(true);
    expect(named.lines[0]).toBe("host set headless: --host headless");
  });

  test("auto refuses a choice no set can make, and --host-features with a named set", async () => {
    process.env["SCRIPTW_HOST_PACK"] = hostPackV2(join(work, "pack-v2-small"), { full: LINUX_SETS.full, offline: [] }, { modules: { "host:demo": [], demo: [] } });
    const none = await build("host-demo", { hostFeatures: ["-net", "rtc"] });
    expect(none.ok).toBe(false);
    if (none.ok) return;
    expect(none.diagnostics[0]!.code).toBe("SC3003");
    expect(none.diagnostics[0]!.message).toContain("no set of the host pack holds rtc without net");
    const both = await build("host-demo", { host: "full", hostFeatures: ["audio"] });
    expect(both.ok).toBe(false);
    if (both.ok) return;
    expect(both.diagnostics[0]!.message).toContain("--host-features applies to --host auto");
  });

  test("a program that reaches no host links no host island", async () => {
    // No host pack is installed or named: a program without page operations or host modules never asks for one.
    const outDir = mkdtempSync(join(work, "plain-"));
    const entry = join(outDir, "plain.ts");
    writeFileSync(entry, 'console.log("plain", 1 + 2);\n');
    const result = await compile(entry, { backend: "llvm", outDir, outPath: join(outDir, "plain") } as never);
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    expect(run(result.binaryPath).stdout).toBe("plain 3\n");
    const symbols = execFileSync("nm", [result.binaryPath], { encoding: "utf8" });
    expect(symbols).not.toContain("scr_host_ops");
  });
});

// android-main (packages/compiler/src/backend/android-main.ts): the same host-island program linked for Android arm64
// as libmain.so, against the stub host built with the NDK. Running it on a device stays the owner's step; this checks
// what the link alone decides: a shared AArch64 object, soname libmain.so, `main` its only export, and every library it
// needs one of bionic's.
const ndk = process.env["ANDROID_NDK_ROOT"] ?? process.env["ANDROID_NDK_HOME"];
const ndkBin = ndk === undefined ? null : join(ndk, "toolchains/llvm/prebuilt/linux-x86_64/bin");
function androidPackHasExecutables(): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(repo, "packages/runtime-android-arm64/runtime-pack.json"), "utf8"));
    return manifest.flavors?.release !== undefined && manifest.host_abi === hostAbi;
  } catch {
    return false;
  }
}
describe.skipIf(!supported || ndkBin === null || !androidPackHasExecutables())("android-main link", () => {
  test("a host-island program links into libmain.so for Android arm64", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-android-main-"));
    const object = join(dir, "stub-host.o");
    mkdirSync(join(dir, "pack/artifacts"), { recursive: true });
    const archive = join(dir, "pack/artifacts/libscriptc_host.a");
    execFileSync(join(ndkBin!, "clang"), [
      "--target=aarch64-linux-android26", "-std=c11", "-O1", "-fPIC", "-I", runtimeSrc,
      "-c", join(fixtures, "stub-host.c"), "-o", object,
    ]);
    execFileSync(join(ndkBin!, "llvm-ar"), ["rcs", archive, object]);
    writeFileSync(join(dir, "pack/host-pack.json"), JSON.stringify({
      schema: "scriptw.host-pack.v1",
      abi: hostAbi,
      target: "aarch64-linux-android",
      archives: { generic: { path: "artifacts/libscriptc_host.a", sha256: createHash("sha256").update(readFileSync(archive)).digest("hex") } },
      linkArgs: ["-llog"],
    }));
    const saved = { target: process.env["SCRIPTC_TARGET"], pack: process.env["SCRIPTW_HOST_PACK"] };
    process.env["SCRIPTC_TARGET"] = "aarch64-linux-android";
    process.env["SCRIPTW_HOST_PACK"] = join(dir, "pack");
    try {
      const outDir = join(dir, "out");
      mkdirSync(outDir);
      copyFileSync(join(fixtures, "host-demo.ts"), join(outDir, "host-demo.ts"));
      copyFileSync(join(fixtures, "host-demo.d.ts"), join(outDir, "host-demo.d.ts"));
      const result = await compile(join(outDir, "host-demo.ts"), {
        backend: "llvm", browser: true, nativeOutput: "android-main", outDir, outPath: join(outDir, "libmain.so"),
      } as never);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const lib = result.binaryPath;
      const header = execFileSync(join(ndkBin!, "llvm-readelf"), ["-h", "-d", lib], { encoding: "utf8" });
      expect(header).toMatch(/Type:\s+DYN/);
      expect(header).toMatch(/Machine:\s+AArch64/);
      expect(header).toContain("Library soname: [libmain.so]");
      const needed = [...header.matchAll(/Shared library: \[([^\]]+)\]/g)].map((m) => m[1]).sort();
      for (const name of needed) expect(["libc.so", "libdl.so", "liblog.so", "libm.so"]).toContain(name);
      const exported = execFileSync(join(ndkBin!, "llvm-nm"), ["-D", "--defined-only", lib], { encoding: "utf8" })
        .trim().split("\n").map((line) => line.trim().split(/\s+/).pop());
      expect(exported).toEqual(["main"]);
      // Android 15+ devices with 16 KB pages load only libraries whose LOAD segments are 16 KB aligned.
      const segments = execFileSync(join(ndkBin!, "llvm-readelf"), ["-l", lib], { encoding: "utf8" });
      const aligns = [...segments.matchAll(/^\s*LOAD\s.*\s(0x[0-9a-f]+)\s*$/gm)].map((m) => Number(m[1]));
      expect(aligns.length).toBeGreaterThan(0);
      for (const align of aligns) expect(align).toBeGreaterThanOrEqual(16384);
    } finally {
      for (const [name, value] of [["SCRIPTC_TARGET", saved.target], ["SCRIPTW_HOST_PACK", saved.pack]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  // The runtime's Android stack guard (scr_stack_thread.h): every thread the program runs on there is a pthread of
  // the host's, so the guard comes from the calling thread's own stack. A static probe runs under user-mode qemu.
  const qemu = ["/usr/bin/qemu-aarch64-static", "/usr/bin/qemu-aarch64"].find((p) => existsSync(p)) ?? null;
  test.skipIf(qemu === null)("the stack guard lies inside the calling thread's stack on Android", () => {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-android-guard-"));
    const probe = join(dir, "stack-guard");
    execFileSync(join(ndkBin!, "clang"), [
      "--target=aarch64-linux-android26", "-std=c11", "-Wall", "-Wextra", "-Werror", "-D_GNU_SOURCE", "-static",
      "-I", runtimeSrc, join(fixtures, "android-stack-guard.c"), "-o", probe,
    ]);
    const r = spawnSync(qemu!, [probe], { encoding: "utf8", timeout: 30_000 });
    expect(r.stdout).toBe("main: guard inside the thread's stack\npthread: guard inside the thread's stack\n");
    expect(r.status).toBe(0);
  });

  test("android-main without the Android target is refused", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "scriptc-android-main-"));
    copyFileSync(join(fixtures, "host-demo.ts"), join(outDir, "host-demo.ts"));
    copyFileSync(join(fixtures, "host-demo.d.ts"), join(outDir, "host-demo.d.ts"));
    const result = await compile(join(outDir, "host-demo.ts"), {
      backend: "llvm", browser: true, nativeOutput: "android-main", outDir, outPath: join(outDir, "libmain.so"),
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]!.message).toContain("SCRIPTC_TARGET=aarch64-linux-android");
  });
});
