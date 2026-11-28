#!/usr/bin/env node
// Installs a packed tarball into a clean directory and checks it:
//
// - each sample under samples/ is compiled to WasmGC and run (`scriptw run`, then `scriptw build` and a run of the
//   .wasm), against Node running the same source: stdout, stderr and the exit status must match. A sample with a
//   `<name>.expect.json` ends in an uncaught error: stdout and the status must match Node, and stderr must include
//   the error's text (Node's own stderr adds a stack trace);
// - the page programs under pages/ build with `--browser` (browser.mjs runs them in Chromium);
// - hosted/scaled.ts, which imports a typed `host:` module, builds with `--browser` and runs under Node through the
//   exported loader, `scriptw/host`;
// - compiled-package/uses-cjs.ts builds with `--browser --compile-packages smoke-cjs` (a CommonJS package installed
//   from its tarball) into a module with no npm JavaScript, which prints what Node prints, and again with
//   --no-native-any;
// - `import("scriptw")` compiles through the programmatic API, and `scriptw --version` names the versions and commit.
//
//   node npm/wasmgc/test/smoke.mjs <package.tgz> [--keep]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tarball = process.argv[2] && path.resolve(process.argv[2]);
if (!tarball || !fs.existsSync(tarball)) { console.error("usage: smoke.mjs <package.tgz> [--keep]"); process.exit(2); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wasmgc-smoke-"));
const sh = (cmd, args, opts = {}) => {
  const t = performance.now();
  const r = spawnSync(cmd, args, { cwd: dir, encoding: "utf8", ...opts });
  return { ...r, ms: Math.round(performance.now() - t) };
};
// npm is a .cmd script on Windows, which runs only through a shell; the paths it gets here have no spaces to quote.
const npm = (args) => sh("npm", args, { shell: process.platform === "win32" });

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) { failures++; if (detail !== undefined) console.log(detail); }
};
// (the files of `from`, not its directories)
const copyDir = (from) => { for (const f of fs.readdirSync(from, { withFileTypes: true })) if (f.isFile()) fs.copyFileSync(path.join(from, f.name), path.join(dir, f.name)); };
const t0 = performance.now();
try {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module" }) + "\n");
  const install = npm(["install", "--no-audit", "--no-fund", tarball]);
  if (install.status !== 0) { console.error(install.stdout, install.stderr); process.exit(1); }
  console.log(`install: ${install.ms} ms`);
  // The installed command: its shim on POSIX; on Windows, whose shim is a .cmd that needs a shell, the CLI it runs.
  const shim = path.join(dir, "node_modules/.bin/scriptw");
  const cli = path.join(dir, "node_modules/scriptw/bin/cli.mjs");
  const scriptw = (args) => process.platform === "win32" ? sh(process.execPath, [cli, ...args]) : sh(shim, args);

  // Samples, against Node.
  copyDir(path.join(here, "samples"));
  for (const sample of fs.readdirSync(path.join(here, "samples")).filter((f) => f.endsWith(".ts")).sort()) {
    const src = path.join(dir, sample);
    const expectFile = path.join(here, "samples", sample.replace(/\.ts$/, ".expect.json"));
    const expect = fs.existsSync(expectFile) ? JSON.parse(fs.readFileSync(expectFile, "utf8")) : null;
    const oracle = sh(process.execPath, [src]);
    const matches = (r) => expect === null
      ? r.stdout === oracle.stdout && r.stderr === oracle.stderr && r.status === oracle.status
      : r.stdout === oracle.stdout && r.status === oracle.status && r.status === expect.status
        && r.stderr.includes(expect.stderrIncludes) && oracle.stderr.includes(expect.stderrIncludes);
    const diff = (r) => ({
      expected: { stdout: oracle.stdout, stderr: oracle.stderr, status: oracle.status },
      got: { stdout: r.stdout, stderr: r.stderr, status: r.status },
    });
    const run = scriptw(["run", src]);
    check(matches(run), `run ${sample}: ${run.ms} ms (node ${oracle.ms} ms)`, diff(run));
    const wasm = src.replace(/\.ts$/, ".wasm");
    const build = scriptw(["build", src, "-o", wasm, "--target", "wasmgc"]);
    const again = scriptw(["run", wasm]);
    const size = fs.existsSync(wasm) ? fs.statSync(wasm).size : 0;
    check(build.status === 0 && matches(again), `build ${sample}: ${build.ms} ms, ${size} bytes; run .wasm ${again.ms} ms`,
      build.status === 0 ? diff(again) : build.stderr);
  }

  // Page programs build with --browser; without it, the DOM is not in scope.
  copyDir(path.join(here, "pages"));
  for (const page of fs.readdirSync(path.join(here, "pages")).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).sort()) {
    const wasm = page.replace(/\.ts$/, ".page.wasm");
    const build = scriptw(["build", page, "--browser", "-o", wasm]);
    const built = build.status === 0 && fs.existsSync(path.join(dir, wasm)) && fs.existsSync(path.join(dir, `${wasm}.host.json`));
    check(built, `build --browser ${page}: ${build.ms} ms`, build.stderr);
  }
  const noDom = scriptw(["build", "todo.ts", "-o", "todo.nodom.wasm"]);
  check(noDom.status === 1 && noDom.stderr.includes("Cannot find name 'document'"), "build todo.ts without --browser refuses the DOM", noDom.stderr);

  // A typed host: module, run under Node through scriptw/host.
  copyDir(path.join(here, "hosted"));
  const hostedBuild = scriptw(["build", "scaled.ts", "--browser", "-o", "scaled.wasm"]);
  const hosted = hostedBuild.status === 0 ? sh(process.execPath, ["run.mjs", "scaled.wasm"]) : hostedBuild;
  check(hosted.status === 0 && hosted.stdout === "scaled 10 20 30\nlater 21\n" && hosted.stderr === "",
    `host: module through scriptw/host: build ${hostedBuild.ms} ms`, { stdout: hosted.stdout, stderr: hosted.stderr, status: hosted.status });

  // --compile-packages: an installed CommonJS package compiled into a page program instead of loaded as npm JavaScript.
  copyDir(path.join(here, "compiled-package"));
  const packed = npm(["pack", "--silent", "--pack-destination", dir, path.join(here, "compiled-package", "smoke-cjs")]);
  const cjsTarball = path.join(dir, "smoke-cjs-1.0.0.tgz");
  const cjsInstall = packed.status === 0 ? npm(["install", "--no-audit", "--no-fund", "--no-save", cjsTarball]) : packed;
  const compiledBuild = cjsInstall.status === 0 ? scriptw(["build", "uses-cjs.ts", "--browser", "--compile-packages", "smoke-cjs", "-o", "uses-cjs.wasm"]) : cjsInstall;
  const compiled = compiledBuild.status === 0 ? sh(process.execPath, ["run.mjs", "uses-cjs.wasm"]) : compiledBuild;
  const cjsOracle = sh(process.execPath, ["uses-cjs.ts"]);
  check(compiled.status === 0 && compiled.stdout === `${cjsOracle.stdout}compiled in\n` && compiled.stderr === "",
    `--compile-packages smoke-cjs: build ${compiledBuild.ms} ms`, { stdout: compiled.stdout, stderr: compiled.stderr, status: compiled.status, node: cjsOracle.stdout });
  // The same with the program's `any` values kept as page values.
  const pageAnyBuild = cjsInstall.status === 0 ? scriptw(["build", "uses-cjs.ts", "--browser", "--compile-packages", "smoke-cjs", "--no-native-any", "-o", "uses-cjs-page-any.wasm"]) : cjsInstall;
  const pageAny = pageAnyBuild.status === 0 ? sh(process.execPath, ["run.mjs", "uses-cjs-page-any.wasm"]) : pageAnyBuild;
  check(pageAny.status === 0 && pageAny.stdout === `${cjsOracle.stdout}compiled in\n` && pageAny.stderr === "",
    `--compile-packages smoke-cjs --no-native-any: build ${pageAnyBuild.ms} ms`, { stdout: pageAny.stdout, stderr: pageAny.stderr, status: pageAny.status, node: cjsOracle.stdout });

  // The programmatic API, and a refusal's diagnostic.
  fs.writeFileSync(path.join(dir, "bad.ts"), "const n: number = 1;\nconst s: string = n;\nconsole.log(s);\n");
  const api = sh(process.execPath, ["--input-type=module", "-e", `
    import { compile, formatDiagnostic } from "scriptw";
    const good = await compile("generics.ts", { outPath: "api/generics.wasm" });
    const bad = await compile("bad.ts");
    console.log(JSON.stringify({ good: good.ok && good.wasmPath.endsWith("generics.wasm"), bad: bad.ok, text: bad.ok ? "" : formatDiagnostic(bad.diagnostics[0]) }));
  `]);
  let result = null;
  try { result = JSON.parse(api.stdout); } catch { /* reported below */ }
  check(api.status === 0 && result?.good === true && result.bad === false && /bad\.ts:2: .*string/.test(result.text) && fs.existsSync(path.join(dir, "api/generics.wasm")),
    `import("scriptw") compile: ${api.ms} ms`, { stdout: api.stdout, stderr: api.stderr });

  // On Linux, the run a darwin-arm64 install makes: the compiler has a native wasm-opt entry for that platform, which
  // the package does not ship, so the package must ask for its wasm-opt.js. The platform is faked before the compiler
  // loads, and TypeScript 7's checker is this machine's (its darwin package is not installed here).
  const tsgo = path.join(dir, "node_modules/@typescript/typescript-linux-x64/lib/tsc");
  if (process.platform === "linux" && process.arch === "x64" && fs.existsSync(tsgo)) {
    fs.writeFileSync(path.join(dir, "fake-darwin-arm64.mjs"),
      'Object.defineProperty(process, "platform", { value: "darwin" }); Object.defineProperty(process, "arch", { value: "arm64" });\n');
    const env = { ...process.env, SCRIPTC_TS7_EXECUTABLE: tsgo };
    delete env.SCRIPTC_WASMOPT_TOOL;
    const mac = sh(process.execPath, ["--import", "./fake-darwin-arm64.mjs", path.join(dir, "node_modules/scriptw/bin/cli.mjs"), "run", "hello.ts"], { env });
    const oracle = sh(process.execPath, ["hello.ts"]);
    check(mac.status === 0 && mac.stdout === oracle.stdout, `run hello.ts as darwin-arm64 (wasm-opt.js): ${mac.ms} ms`, mac.stderr);
  }

  // --version: the package and compiler versions, and the commit assemble.mjs stamped.
  const version = scriptw(["--version"]);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "node_modules/scriptw/package.json"), "utf8"));
  check(version.status === 0 && version.stdout.startsWith(`scriptw ${pkg.version}\n`) && /^compiler \d+\.\d+\.\d+/m.test(version.stdout) && /^commit [0-9a-f]{40}/m.test(version.stdout),
    `--version: ${version.stdout.trim().replaceAll("\n", ", ")}`, version.stdout + version.stderr);
  // Companion versions, when the manifest lists them, are the package's own.
  const companions = Object.entries(pkg.optionalDependencies ?? {});
  check(companions.every(([, v]) => v === pkg.version), `companion versions follow ${pkg.version} (${companions.length} listed)`, pkg.optionalDependencies);
} finally {
  if (process.argv.includes("--keep")) console.log(`kept ${dir}`);
  else fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`smoke: ${failures === 0 ? "passed" : `${failures} failed`} in ${Math.round((performance.now() - t0) / 1000)} s`);
process.exit(failures ? 1 : 0);
