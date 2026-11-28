// The programmatic compiler: `import { compile } from "scriptw"`. Node only (the type checker is a native executable).
import fs from "node:fs";
import path from "node:path";

const compilerDist = new URL("../packages/compiler/dist/", import.meta.url);

// The package ships wasm-opt 133 as JavaScript and wasm only (vendor/binaryen-133/binaryen-version_133), not the native
// per-platform wasm-opt the repository fetches for darwin-arm64. The emitter refuses to fall back to wasm-opt.js
// silently where a native build exists, so the package asks for it; a caller's own setting wins.
process.env.SCRIPTC_WASMOPT_TOOL ??= "js";

/** Compiles `entry` to a WasmGC module at `options.outPath` (default: the entry with a `.wasm` extension). */
export async function compile(entry, options = {}) {
  const { compile: compileModule } = await import(new URL("index.js", compilerDist));
  const entryPath = path.resolve(entry);
  const outPath = path.resolve(options.outPath ?? entryPath.replace(/\.(m|c)?[jt]sx?$/, "") + ".wasm");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const r = await compileModule(entryPath, {
    outDir: path.dirname(outPath),
    outPath,
    outputKind: "wasmgc",
    release: options.release === true,
    ...(options.browser === true ? { browser: true } : {}),
    // A page program's dynamic values use the native WasmGC object model, the one UI packages written for WasmGC
    // (@scriptw/lui) and the framework builds compile with; `dynModel: "engine"` keeps them as engine values behind host
    // calls, for the smallest module. It has no effect without `browser`.
    ...(options.browser === true ? { dynModel: options.dynModel ?? "native" } : {}),
    // The `wasmgc` condition lets a package ship TypeScript source for compiled builds beside its JavaScript
    // (`"wasmgc": "./src/index.ts"`): that source is compiled into the module rather than run as npm JavaScript.
    conditions: ["wasmgc", ...(options.conditions ?? []).filter((c) => c !== "wasmgc")],
    // Named npm packages whose JavaScript is compiled into the module (the compiler's npm-static mode) instead of
    // loaded as npm JavaScript; a package it cannot take that way stays npm JavaScript (with a note) or fails the build.
    ...(options.compilePackages?.length ? { npmStatic: [...options.compilePackages] } : {}),
    // A compiled-in package's values are compiled objects, and the program usually types them `any` (a package's
    // declarations are not what its compiled JavaScript is typed from): with packages compiled in, the program's `any`
    // values are compiled values too, not page values, unless `nativeAny: false` asks for page values.
    ...(options.compilePackages?.length && options.browser === true && (options.dynModel ?? "native") === "native" && options.nativeAny !== false
      ? { experimentalTsNativeAny: true } : {}),
    // The package builds auto capabilities against the default (or given) targets: a compat variant only when a target
    // needs one and the program uses the feature that differs.
    capabilities: options.capabilities ?? "auto",
    ...(options.targets === undefined ? {} : { targets: options.targets }),
  });
  if (!r.ok) {
    return {
      ok: false,
      diagnostics: r.diagnostics.map((d) => {
        const file = d.loc?.file || undefined;
        const line = file === undefined ? undefined : lineOf(r.sourceTexts, file, d.loc.start);
        return {
          message: d.message,
          ...(d.code === undefined ? {} : { code: d.code }),
          ...(file === undefined ? {} : { file }),
          ...(line === undefined ? {} : { line }),
          ...(d.hint === undefined ? {} : { hint: d.hint }),
        };
      }),
    };
  }
  const a = r.artifact;
  return {
    ok: true,
    wasmPath: outPath,
    hostSidecarPath: `${outPath}.host.json`,
    capabilitiesPath: `${outPath}.capabilities.json`,
    capabilities: a.capabilities,
    variants: (a.variants ?? []).map((v) => ({ wasmPath: v.path, key: v.key, requires: v.requires })),
    ...(a.variants?.length > 1 ? { variantsPath: `${outPath}.variants.json` } : {}),
    explainCapabilities: a.explainCapabilities ?? [],
  };
}

/** The 1-based line of a source offset, when the source can be read. */
function lineOf(sourceTexts, file, offset) {
  if (typeof offset !== "number" || offset < 0) return undefined;
  let text = sourceTexts?.get?.(file);
  if (text === undefined) {
    try { text = fs.readFileSync(file, "utf8"); } catch { return undefined; }
  }
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** A diagnostic as one line: `file:line: code: message`, with the parts it has. */
export function formatDiagnostic(d) {
  const where = d.file === undefined ? "" : `${d.file}${d.line === undefined ? "" : `:${d.line}`}: `;
  return `${where}${d.code === undefined ? "" : `${d.code}: `}${d.message}${d.hint === undefined ? "" : `\n  hint: ${d.hint}`}`;
}
