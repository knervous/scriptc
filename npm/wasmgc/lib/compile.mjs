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
  return { ok: true, wasmPath: outPath, hostSidecarPath: `${outPath}.host.json` };
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
