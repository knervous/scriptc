// The host island's differential lane against the generic host (native/host): host-island programs compiled natively
// with the native dyn model, linked against the generic host's archive (libscriptc_host.a, default-entry), run, and
// compared with Node byte for byte (stdout, stderr, exit status). Page programs (the DOM, timers, frames), which Node
// cannot run, compare with their .expected files; one marked `// @unordered` compares as a set of lines.
//
// The archive: SCRIPTW_GENERIC_HOST_LIB, else native/host/target/release/libscriptc_host.a
// (`cargo build --release -p scriptc-host` in native/host). Without one the lane is skipped, and says so.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const repo = join(import.meta.dirname, "../..");
const fixtures = join(repo, "tests/fixtures/host-island/generic");
const builtArchive = join(repo, "native/host/target/release/libscriptc_host.a");
const archive = process.env["SCRIPTW_GENERIC_HOST_LIB"] ?? (existsSync(builtArchive) ? builtArchive : null);
// What the generic host's staticlib needs on Linux (rustc --print native-static-libs).
const LINUX_HOST_LINK_ARGS = ["-lfontconfig", "-lfreetype", "-ldl", "-lgcc_s", "-lutil", "-lrt", "-lpthread", "-lm"];
const supported =
  process.platform === "linux" && process.arch === "x64" && process.env["SCRIPTC_SAN"] !== "1" && archive !== null;
if (!supported && process.platform === "linux") {
  console.warn("host-island-generic: no generic host archive (set SCRIPTW_GENERIC_HOST_LIB or build native/host); skipped");
}
const tsx = join(repo, "node_modules/.bin/tsx");

// The native dyn model's untyped programs (the experimental native-any lane the host island runs).
const NATIVE_ANY = { dynModel: "native", hostHandles: true, interfaceClassArms: true, experimentalTsNativeAny: true };

/** Known differences with Node, named so the lane flips when they are fixed. */
const KNOWN_DIFFERENCES: Record<string, string> = {
  // A frozen array's pop() writes instead of throwing a TypeError on the native dyn model.
  "freeze-typed": "Object.freeze of an array on the native dyn model",
};

let work: string;

async function buildNative(src: string, name: string, extra: Record<string, unknown>): Promise<string> {
  const outDir = mkdtempSync(join(work, `${name}-`));
  const result = await compile(src, {
    outDir,
    outPath: join(outDir, name),
    optimization: "dev",
    browser: true,
    hostLib: archive!,
    hostLinkArgs: LINUX_HOST_LINK_ARGS,
    ...extra,
  } as never);
  if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  return result.binaryPath;
}

function outcome(r: ReturnType<typeof spawnSync>): string {
  return `${r.stdout}${r.stderr}exit ${r.status}\n`;
}

describe.skipIf(!supported)("host island against the generic host", () => {
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "scriptc-generic-host-"));
  });
  // Each binary carries the host (hundreds of MB in a dev build): the lane leaves none behind.
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  const dyn = existsSync(join(fixtures, "dyn"))
    ? readdirSync(join(fixtures, "dyn")).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).sort()
    : [];
  for (const file of dyn) {
    const name = file.replace(/\.ts$/, "");
    const run = KNOWN_DIFFERENCES[name] === undefined ? test : test.fails;
    run(`${name} matches Node`, async () => {
      const src = join(fixtures, "dyn", file);
      const saved = process.env["SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY"];
      process.env["SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY"] = "1";
      let binary: string;
      try {
        binary = await buildNative(src, name, NATIVE_ANY);
      } finally {
        if (saved === undefined) delete process.env["SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY"];
        else process.env["SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY"] = saved;
      }
      const native = spawnSync(binary, [], { cwd: join(fixtures, "dyn"), encoding: "utf8", timeout: 30_000 });
      const node = spawnSync(tsx, [src], { cwd: join(fixtures, "dyn"), encoding: "utf8", timeout: 60_000 });
      expect(outcome(native)).toBe(outcome(node));
    }, 300_000);
  }

  const pages = existsSync(join(fixtures, "page"))
    ? readdirSync(join(fixtures, "page")).filter((f) => f.endsWith(".ts")).sort()
    : [];
  for (const file of pages) {
    const name = file.replace(/\.ts$/, "");
    test(`${name} prints its expected output`, async () => {
      const src = join(fixtures, "page", file);
      const binary = await buildNative(src, name, {});
      const r = spawnSync(binary, [], { encoding: "utf8", timeout: 30_000 });
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      const expected = readFileSync(join(fixtures, "page", `${name}.expected`), "utf8");
      if (/^\/\/ @unordered/m.test(readFileSync(src, "utf8"))) {
        expect(r.stdout.split("\n").sort()).toEqual(expected.split("\n").sort());
      } else {
        expect(r.stdout).toBe(expected);
      }
    }, 300_000);
  }

  test("the generic host defines scr_host_ops, and the island checks its ABI", () => {
    const symbols = execFileSync("nm", ["--defined-only", archive!], { encoding: "utf8", maxBuffer: 1 << 30 });
    expect(symbols).toMatch(/ T scr_host_ops$/m);
  });
});

// The host sets (native/host/scripts/build-host-pack.mjs): a typed fetch() against each archive of a host pack
// (SCRIPTW_GENERIC_HOST_PACK, a pack directory), served by the lane's own http server on 127.0.0.1. The full and
// headless sets reach it; offline rejects with fetch's TypeError; every set answers data: and blob: URLs.
const hostPack = process.env["SCRIPTW_GENERIC_HOST_PACK"] ?? null;
const HOST_SET_ARCHIVES: readonly (readonly [string, string, "net" | "offline"])[] = [
  ["full", "libscriptc_host.a", "net"],
  ["headless", "libscriptc_host_headless.a", "net"],
  ["offline", "libscriptc_host_offline.a", "offline"],
];
describe.skipIf(!supported || hostPack === null)("a typed fetch under each host set", () => {
  let server: import("node:http").Server;
  let port = 0;
  let fetchWork = "";
  beforeAll(async () => {
    const { createServer } = await import("node:http");
    server = createServer((_req, res) => res.end("hello from the lane"));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    port = (server.address() as import("node:net").AddressInfo).port;
    fetchWork = mkdtempSync(join(tmpdir(), "scriptc-host-sets-"));
  });
  afterAll(() => {
    rmSync(fetchWork, { recursive: true, force: true });
    return new Promise<void>((done) => server.close(() => done()));
  });

  for (const [set, file, expected] of HOST_SET_ARCHIVES) {
    const setArchive = hostPack === null ? "" : join(hostPack, "artifacts", file);
    test.skipIf(!existsSync(setArchive))(`fetch-sets on the ${set} set`, async () => {
      const outDir = mkdtempSync(join(fetchWork, `fetch-${set}-`));
      const result = await compile(join(fixtures, "fetch/fetch-sets.ts"), {
        outDir,
        outPath: join(outDir, "fetch-sets"),
        optimization: "dev",
        browser: true,
        hostLib: setArchive,
        hostLinkArgs: LINUX_HOST_LINK_ARGS,
      } as never);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { execFile } = await import("node:child_process");
      // Asynchronous: the lane's server answers on this process's event loop.
      const r = await new Promise<{ stdout: string; stderr: string; status: number | null }>((done) => {
        const child = execFile(result.binaryPath, [], {
          encoding: "utf8",
          timeout: 30_000,
          env: { ...process.env, SCRIPTC_HOST_PAGE_URL: `http://localhost/?port=${port}`, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
        }, (_error, stdout, stderr) => done({ stdout, stderr, status: child.exitCode }));
      });
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(readFileSync(join(fixtures, `fetch/fetch-sets.${expected}.expected`), "utf8"));
    }, 300_000);
  }
});

// --host auto against a host pack (SCRIPTW_GENERIC_HOST_PACK): the set each fixture's reach chooses (host-features.ts),
// its --explain-host line, and the program's output under it. The document and timers are the core's, so the page
// fixtures take offline; a fetch takes the network's set; the global object read as a value takes full.
const AUTO_CASES: readonly { file: string; set: string; expected?: string; dyn?: true; serve?: true }[] = [
  { file: "page/dom-timers.ts", set: "offline" },
  { file: "page/compiled-errors.ts", set: "offline" },
  // `const g: any = globalThis`: the global object as a value, which the pass cannot read, so every service.
  { file: "dyn/island-destructure.ts", set: "full", dyn: true },
  { file: "fetch/fetch-sets.ts", set: "headless", expected: "fetch/fetch-sets.net.expected", serve: true },
];
describe.skipIf(!supported || hostPack === null)("--host auto against a host pack", () => {
  let server: import("node:http").Server;
  let port = 0;
  let autoWork = "";
  beforeAll(async () => {
    const { createServer } = await import("node:http");
    server = createServer((_req, res) => res.end("hello from the lane"));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    port = (server.address() as import("node:net").AddressInfo).port;
    autoWork = mkdtempSync(join(tmpdir(), "scriptc-host-auto-"));
  });
  afterAll(() => {
    rmSync(autoWork, { recursive: true, force: true });
    return new Promise<void>((done) => server.close(() => done()));
  });

  for (const c of AUTO_CASES) {
    const name = c.file.replace(/^.*\//, "").replace(/\.ts$/, "");
    test(`${name} takes the ${c.set} set`, async () => {
      const outDir = mkdtempSync(join(autoWork, `${name}-`));
      const saved = { pack: process.env["SCRIPTW_HOST_PACK"], any: process.env["SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY"] };
      process.env["SCRIPTW_HOST_PACK"] = hostPack!;
      if (c.dyn) process.env["SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY"] = "1";
      const lines: string[] = [];
      const write = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
        if (String(chunk).startsWith("host set ")) lines.push(String(chunk).trim());
        return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stderr.write;
      let result;
      try {
        result = await compile(join(fixtures, c.file), {
          outDir, outPath: join(outDir, name), optimization: "dev", browser: true, explainHost: true,
          ...(c.dyn ? NATIVE_ANY : {}),
        } as never);
      } finally {
        process.stderr.write = write;
        for (const [key, value] of [["SCRIPTW_HOST_PACK", saved.pack], ["SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY", saved.any]] as const) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      expect(lines[0]).toMatch(new RegExp(`^host set ${c.set} `));
      const { execFile } = await import("node:child_process");
      const r = await new Promise<{ stdout: string; stderr: string; status: number | null }>((done) => {
        const child = execFile(result.binaryPath, [], {
          cwd: join(fixtures, c.file, ".."),
          encoding: "utf8",
          timeout: 30_000,
          env: { ...process.env, SCRIPTC_HOST_PAGE_URL: `http://localhost/?port=${port}`, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
        }, (_error, stdout, stderr) => done({ stdout, stderr, status: child.exitCode }));
      });
      expect(r.status).toBe(0);
      if (c.dyn) {
        const node = spawnSync(tsx, [join(fixtures, c.file)], { cwd: join(fixtures, "dyn"), encoding: "utf8", timeout: 60_000 });
        expect(outcome(r as never)).toBe(outcome(node));
      } else {
        expect(r.stderr).toBe("");
        const expected = readFileSync(join(fixtures, c.expected ?? c.file.replace(/\.ts$/, ".expected")), "utf8");
        if (/^\/\/ @unordered/m.test(readFileSync(join(fixtures, c.file), "utf8"))) expect(r.stdout.split("\n").sort()).toEqual(expected.split("\n").sort());
        else expect(r.stdout).toBe(expected);
      }
    }, 300_000);
  }
});

// The generic host for Android arm64 (SCRIPTW_GENERIC_HOST_ANDROID_LIB, built with
// `cargo build --release --locked -p scriptc-host --target aarch64-linux-android` and the NDK's clang): a page
// program linked into libmain.so with the host pack's JNI entry points rooted, so the Activity's calls find them.
// Running it on a device is the owner's step; this checks what the link decides.
const androidArchive = process.env["SCRIPTW_GENERIC_HOST_ANDROID_LIB"] ?? null;
const ndkRoot = process.env["ANDROID_NDK_ROOT"] ?? null;
const ndkTools = ndkRoot === null ? null : join(ndkRoot, "toolchains/llvm/prebuilt/linux-x86_64/bin");
describe.skipIf(process.platform !== "linux" || androidArchive === null || ndkTools === null)(
  "libmain.so against the generic Android host",
  () => {
    test("a page program links into libmain.so exporting main and the host's JNI entry points", async () => {
      const { createHash } = await import("node:crypto");
      const { copyFileSync, mkdirSync, writeFileSync } = await import("node:fs");
      const dir = mkdtempSync(join(tmpdir(), "scriptc-generic-android-"));
      const pack = join(dir, "pack");
      mkdirSync(join(pack, "artifacts"), { recursive: true });
      copyFileSync(androidArchive!, join(pack, "artifacts/libscriptc_host.a"));
      const defined = execFileSync(join(ndkTools!, "llvm-nm"), ["--defined-only", androidArchive!], {
        encoding: "utf8",
        maxBuffer: 1 << 30,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const jni = [...new Set(defined.split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p[1] === "T" && /^(JNI_OnLoad$|Java_)/.test(p[2] ?? "")).map((p) => p[2]!))].sort();
      expect(jni).toContain("JNI_OnLoad");
      writeFileSync(join(pack, "host-pack.json"), JSON.stringify({
        schema: "scriptw.host-pack.v1",
        abi: 3,
        target: "aarch64-linux-android",
        archives: { generic: { path: "artifacts/libscriptc_host.a", sha256: createHash("sha256").update(readFileSync(androidArchive!)).digest("hex") } },
        linkArgs: ["-landroid", "-llog", "-laaudio", "-lEGL", "-lGLESv3", "-ljnigraphics", "-ldl", "-lunwind", "-lm"],
        exports: jni,
      }));
      const saved = { target: process.env["SCRIPTC_TARGET"], pack: process.env["SCRIPTW_HOST_PACK"] };
      process.env["SCRIPTC_TARGET"] = "aarch64-linux-android";
      process.env["SCRIPTW_HOST_PACK"] = pack;
      try {
        const outDir = join(dir, "out");
        mkdirSync(outDir);
        const result = await compile(join(fixtures, "page/dom-timers.ts"), {
          backend: "llvm", browser: true, nativeOutput: "android-main", outDir, outPath: join(outDir, "libmain.so"),
        } as never);
        if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
        const header = execFileSync(join(ndkTools!, "llvm-readelf"), ["-h", "-d", result.binaryPath], { encoding: "utf8" });
        expect(header).toMatch(/Type:\s+DYN/);
        expect(header).toContain("Library soname: [libmain.so]");
        const needed = [...header.matchAll(/Shared library: \[([^\]]+)\]/g)].map((m) => m[1]);
        const system = ["libc.so", "libm.so", "libdl.so", "liblog.so", "libandroid.so", "libaaudio.so", "libEGL.so", "libGLESv3.so", "libjnigraphics.so"];
        for (const name of needed) expect(system).toContain(name);
        const exported = execFileSync(join(ndkTools!, "llvm-nm"), ["-D", "--defined-only", result.binaryPath], { encoding: "utf8" })
          .trim().split("\n").map((l) => l.trim().split(/\s+/).pop()!).sort();
        expect(exported).toEqual(["main", ...jni].sort());
        // 16 KB-page devices (Android 15+): every LOAD segment 16 KB aligned.
        const segments = execFileSync(join(ndkTools!, "llvm-readelf"), ["-l", result.binaryPath], { encoding: "utf8" });
        const aligns = [...segments.matchAll(/^\s*LOAD\s.*\s(0x[0-9a-f]+)\s*$/gm)].map((m) => Number(m[1]));
        expect(aligns.length).toBeGreaterThan(0);
        for (const align of aligns) expect(align).toBeGreaterThanOrEqual(16384);
        // The runtime's Android glue: the wrapped entry, main's thread, the uncaught hook and the embedder's hook.
        const symbols = execFileSync(join(ndkTools!, "llvm-nm"), [result.binaryPath], { encoding: "utf8", maxBuffer: 1 << 30 });
        for (const name of ["__wrap_main", "scr_host_android_is_main", "scr_host_install_uncaught_hook", "scr_host_android_before_main"])
          expect(symbols).toMatch(new RegExp(` [tTwW] ${name}$`, "m"));
      } finally {
        for (const [name, value] of [["SCRIPTC_TARGET", saved.target], ["SCRIPTW_HOST_PACK", saved.pack]] as const) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    }, 600_000);
  },
);
