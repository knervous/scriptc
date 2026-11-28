// Builds a framework's app to WasmGC with this repository's compiler (browser: true), one build per process.
//
//   node benchmarks/frameworks/build-wasm.mjs <solid|svelte> <variant> [out.wasm] [--dev]
//
// Variants:
//   published  the JavaScript lane's own bundle (out/<framework>.bundle.js: the framework's published ESM and the
//              compiled app), compiled as it is; every value in it is untyped
//
// The module exports mount(id) and cycle(), as the JavaScript lane's entry does. BUILD_OPTIONS (JSON) adds compile
// options; SCRIPTC_WASMGC_NAMED=1 keeps function names for the profiler.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const argv = process.argv.slice(2);
const [framework, variant] = argv;
const out = path.resolve(argv[2] && !argv[2].startsWith("--") ? argv[2] : path.join(here, "out", `${framework}.${variant}.wasm`));
const dev = argv.includes("--dev");

const stage = path.join(here, "stage", `${framework}.${variant}`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

if (variant === "published") {
  fs.copyFileSync(path.join(here, "out", `${framework}.bundle.js`), path.join(stage, "bundle.js"));
  fs.writeFileSync(path.join(stage, "entry.ts"), [
    `import { cycle as runCycle, mount as mountApp } from "./bundle.js";`,
    `export function mount(id: string): void { mountApp(id); }`,
    `export function cycle(): number { return runCycle(); }`, ""].join("\n"));
  fs.writeFileSync(path.join(stage, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, noImplicitAny: false, allowJs: true, checkJs: false,
    noEmit: true, lib: ["es2022", "dom", "dom.iterable"], skipLibCheck: true, types: [] } }, null, 1));
} else if (framework === "solid" && (variant === "port" || variant === "stream")) {
  // The typed port of Solid's runtime (solid/port, PATCHES.md) and the app's JSX through babel-preset-solid, kept as
  // TypeScript. port: the page's DOM, one host call per operation; stream: the DOM stream (packages/dom-stream).
  const { solidJsx, solidTypedOutput } = await import("./build-js.mjs");
  const src = path.join(here, "solid/app/app.tsx");
  fs.writeFileSync(path.join(stage, "app.ts"), solidTypedOutput(solidJsx(fs.readFileSync(src, "utf8"), src), src));
  fs.writeFileSync(path.join(stage, "entry.ts"), [
    `import { cycle as runCycle, mount as mountApp } from "./app.ts";`,
    `export function mount(id: string): void { mountApp(document.getElementById(id)!); }`,
    `export function cycle(): number { return runCycle(); }`, ""].join("\n"));
  const port = path.relative(stage, path.join(here, "solid/port"));
  fs.writeFileSync(path.join(stage, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, allowImportingTsExtensions: true,
    noEmit: true, lib: ["es2022", "dom", "dom.iterable"], skipLibCheck: true, types: [],
    paths: {
      "solid-js": [`${port}/solid-js.ts`], "solid-js/web": [`${port}/web.ts`],
      "solid-port-dom": [`${port}/${variant === "stream" ? "dom-stream.ts" : "dom-page.ts"}`],
      "dom-stream/*": [path.relative(stage, path.join(root, "packages/dom-stream/src")) + "/*"],
    } } }, null, 1));
} else if (framework === "lui" && (variant === "port" || variant === "stream")) {
  // LUI is TypeScript already (packages/lui): the app and the runtime compile as they are. port: its default DOM module,
  // the page's own nodes; stream: its dom-stream module (the package's `dom-stream` import condition).
  fs.writeFileSync(path.join(stage, "entry.ts"), [
    `import { cycle as runCycle, mount as mountApp } from "${path.relative(stage, path.join(here, "lui/app/app.ts"))}";`,
    `export function mount(id: string): void { mountApp(document.getElementById(id)!); }`,
    `export function cycle(): number { return runCycle(); }`, ""].join("\n"));
  const lui = path.relative(stage, path.join(root, "packages/lui/src"));
  fs.writeFileSync(path.join(stage, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, allowImportingTsExtensions: true,
    noEmit: true, lib: ["es2022", "dom", "dom.iterable"], skipLibCheck: true, types: [],
    paths: { "@scriptw/lui": [`${lui}/index.ts`], "#dom": [`${lui}/${variant === "stream" ? "dom-stream.ts" : "dom.ts"}`] } } }, null, 1));
} else if (framework === "svelte" && variant === "stream") {
  // Svelte's published runtime (bundled, untyped, with svelte/PATCHES.md's stream patch) and the app's components compiled for
  // a custom renderer: svelte/stream/renderer.ts, TypeScript over the DOM stream's compiled nodes.
  const { bundleSvelteStream } = await import("./build-js.mjs");
  await bundleSvelteStream(path.join(stage, "bundle.js"));
  fs.writeFileSync(path.join(stage, "entry.ts"), [
    `import { cycle as runCycle, mount as mountApp } from "./bundle.js";`,
    `export function mount(id: string): void { mountApp(document.getElementById(id)!); }`,
    `export function cycle(): number { return runCycle(); }`, ""].join("\n"));
  fs.writeFileSync(path.join(stage, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, noImplicitAny: false, allowJs: true, checkJs: false,
    allowImportingTsExtensions: true, noEmit: true, lib: ["es2022", "dom", "dom.iterable"], skipLibCheck: true, types: [],
    paths: {
      "svelte-stream-renderer": [path.relative(stage, path.join(here, "svelte/stream/renderer.ts"))],
      "dom-stream/*": [path.relative(stage, path.join(root, "packages/dom-stream/src")) + "/*"],
    } } }, null, 1));
} else if (framework === "svelte" && variant === "jsdoc") {
  // Svelte's published source (its JavaScript with its JSDoc types, unbundled), and the app's components compiled by
  // the Svelte compiler. checkJs lets the compiler read the JSDoc types; esm-env's flags are the production browser's.
  const { svelteComponent, svelteModule } = await import("./build-js.mjs");
  const src = path.join(here, "node_modules/svelte/src");
  const skip = new Set(["compiler", "server", "internal/server"]);
  fs.cpSync(src, path.join(stage, "svelte"), { recursive: true, filter: (f) => !skip.has(path.relative(src, f).split(path.sep).slice(0, 2).join("/")) && !skip.has(path.relative(src, f).split(path.sep)[0]) });
  applyPatches(path.join(stage, "svelte"), svelteJsdocPatches());
  fs.copyFileSync(path.join(here, "node_modules/clsx/dist/clsx.mjs"), path.join(stage, "clsx.js"));
  fs.writeFileSync(path.join(stage, "esm-env.js"), "export const BROWSER = true;\nexport const DEV = false;\nexport const NODE = false;\n");
  await writeSvelteApp(stage, svelteComponent, svelteModule);
  fs.writeFileSync(path.join(stage, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, noImplicitAny: false, allowJs: true, checkJs: true,
    noEmit: true, lib: ["es2022", "dom", "dom.iterable"], skipLibCheck: true, types: [],
    paths: {
      "svelte": ["./svelte/index-client.js"], "svelte/internal/client": ["./svelte/internal/client/index.js"],
      "svelte/internal/disclose-version": ["./svelte/internal/disclose-version.js"], "svelte/internal/init-operations": ["./svelte/internal/init-operations.js"],
      "svelte/internal/flags/*": ["./svelte/internal/flags/*.js"],
      "#client": ["./svelte/internal/client/types.d.ts"], "#client/constants": ["./svelte/internal/client/constants.js"],
      "#shared": ["./svelte/internal/shared/types.d.ts"], "esm-env": ["./esm-env.js"], "clsx": ["./clsx.js"],
    } } }, null, 1));
} else {
  console.error(`unknown variant ${variant}`);
  process.exit(1);
}

/** Edits to a staged copy of a framework's published files, each one listed in that framework's PATCHES.md: the file, the
 * exact text it replaces (which must occur once) and its replacement. */
function applyPatches(dir, patches) {
  for (const [file, from, to] of patches) {
    const f = path.join(dir, file), text = fs.readFileSync(f, "utf8");
    if (text.split(from).length !== 2) throw new Error(`patch for ${file} does not apply: ${JSON.stringify(from.slice(0, 60))}`);
    fs.writeFileSync(f, text.replace(from, () => to));
  }
}

/** svelte/PATCHES.md. */
function svelteJsdocPatches() { return [
  // Trusted Types: the policy's createHTML answers a TrustedHTML object, which the JSDoc cast calls a string.
  ["internal/client/dom/reconciler.js", "globalThis?.window?.trustedTypes &&", "/** @type {any} */ (globalThis).__noTrustedTypes &&"],
  // child's is_text: the compiled components omit it (it is undefined there), so it is optional, as first_child's is.
  ["internal/client/dom/operations.js", " * @param {N} node\n * @param {boolean} is_text\n", " * @param {N} node\n * @param {boolean} [is_text]\n"],
]; }

/** The Svelte app's components and modules, compiled by the Svelte compiler into `<stage>/app` (imports renamed to .js). */
async function writeSvelteApp(stage, svelteComponent, svelteModule) {
  const appDir = path.join(here, "svelte/app"), outDir = path.join(stage, "app");
  fs.mkdirSync(outDir, { recursive: true });
  const rename = (code) => code.replace(/from "(\.\/[^"]+)\.svelte\.ts"/g, 'from "$1.svelte.js"').replace(/from "(\.\/[^"]+)\.svelte"/g, 'from "$1.svelte.js"');
  for (const f of fs.readdirSync(appDir)) {
    const source = fs.readFileSync(path.join(appDir, f), "utf8");
    if (f.endsWith(".svelte")) fs.writeFileSync(path.join(outDir, `${f}.js`), rename(await svelteComponent(source, f)));
    else if (f.endsWith(".svelte.ts")) fs.writeFileSync(path.join(outDir, f.replace(/\.ts$/, ".js")), rename(await svelteModule(source, f)));
  }
  fs.writeFileSync(path.join(stage, "entry.ts"), [
    `import { cycle as runCycle, mount as mountApp } from "./app/main.svelte.js";`,
    `export function mount(id: string): void { mountApp(document.getElementById(id)!); }`,
    `export function cycle(): number { return runCycle(); }`, ""].join("\n"));
}

const { compile } = await import(path.join(root, "packages/compiler/dist/index.js"));
const extra = process.env.BUILD_OPTIONS ? JSON.parse(process.env.BUILD_OPTIONS) : {};
const t0 = Date.now();
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = await compile(path.join(stage, "entry.ts"), {
  experimentalDynI31: true, experimentalDynInlineSlots: 6, ...extra,
  outDir: path.dirname(out), outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native", experimentalTsNativeAny: true,
  interfaceClassArms: true, optimization: dev ? "dev" : undefined, wasmLink: { exports: ["mount", "cycle"] },
});
if (!r.ok) {
  for (const d of r.diagnostics) console.error(`${d.code ?? ""} ${d.message} ${d.loc ? `${d.loc.file}:${d.loc.line}:${d.loc.col}` : ""}`);
  process.exit(1);
}
console.log(`ok ${path.relative(process.cwd(), out)} ${fs.statSync(out).size}B ${(Date.now() - t0) / 1000}s`);
