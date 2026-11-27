// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import type { CompileFailure, CompileRequestOptions } from "../compile-types.js";
import type { FfiProfile } from "../ffi/ffi-manifest.js";
import { checkerPanicDiag, iceDiag, isCheckerPanic, type ScrDiagnostic } from "../diagnostics/diagnostic.js";
import type { IrModule, SrcLoc } from "../ir/ir.js";
import { validateModule } from "../ir/validate.js";
import { serializeModule } from "../ir/serialize.js";
import { writeFileSync } from "node:fs";
import { fenceSpeculativeWasiFunctions, moduleWasiUnavailableSurface, targetRefusalDiag } from "../backend/target-diagnostics.js";
import type { LowerResult, LowerStats } from "../frontend/lowering/lowerer.js";
import type { FrontendFactory } from "../frontend/pipeline.js";
import type { CompilationTiming } from "../timing.js";

export interface PreparedExecutableModule {
  ok: true;
  mod: IrModule;
  sourceTexts: Map<string, string>;
  stats: LowerStats;
}

/** Release the parser/checker before native object generation begins. */
export function prepareExecutableModule(
  entryPath: string,
  opts: CompileRequestOptions,
  ffi: FfiProfile | null,
  buildPlatform: string,
  createFrontend: FrontendFactory,
  timing: CompilationTiming = () => {},
): PreparedExecutableModule | CompileFailure {
  const fe = createFrontend(entryPath, opts.npmStatic);
  timing("frontend-load");
  let lowered: LowerResult;
  let sourceTexts: Map<string, string>;
  // The frontend (and its tsgo server) is released as soon as lowering
  // ends — clang and the link never hold it open.
  try {
    const fail = (diagnostics: ScrDiagnostic[]): CompileFailure => ({
      ok: false,
      diagnostics,
      sourceTexts: fe.sourceTexts(),
    });

    if (fe.preflight.length > 0) return fail(fe.preflight);

    try {
      const link = (opts as { wasmLink?: { exports?: string[]; ffiModule?: string } }).wasmLink;
      // The LLVM lane's piece exports (nativeExports) are roots the same way.
      const nativeExports = (opts as { nativeExports?: readonly { name: string }[] }).nativeExports;
      const linkExports = [...(link?.exports ?? []), ...(nativeExports ?? []).map((e) => e.name)];
      lowered = fe.lower({
        dynamic: opts.dynamic ?? false,
        targetPlatform: buildPlatform,
        // Link exports are reachability roots: other modules call them.
        ...(linkExports?.length ? { libRoots: linkExports } : {}),
        // Separate compilation: the entry is one object unit (link/object.ts).
        ...(opts.objectUnit ? { objectUnit: opts.objectUnit } : {}),
        ...(ffi !== null ? { ffiImports: ffi.functions } : {}),
        // A piece linked against another module's FFI surface declares only the bindings it uses.
        ...(ffi !== null && (link?.ffiModule !== undefined || (nativeExports?.length ?? 0) > 0) ? { ffiManifestCapacity: true } : {}),
      });
      timing("lower");
    } catch (e) {
      // The last-resort panic fence: an upstream tsgo panic that crossed a
      // checker call no statement/collection fence wrapped still becomes a
      // clean failed compile (anchored at the entry), never a crashed CLI.
      if (!isCheckerPanic(e)) throw e;
      return fail([
        checkerPanicDiag(e.message.split("\n", 1)[0]!, { file: entryPath, start: 0, end: 0 }),
      ]);
    }
    if (lowered.module === null) return fail(lowered.diagnostics);

    const validation = validateModule(lowered.module);
    timing("ir-validate");
    if (validation.length > 0) {
      // Debug aid: SCRIPTC_DUMP_INVALID_IR=<path> writes the rejected IR.
      const dump = process.env.SCRIPTC_DUMP_INVALID_IR;
      if (dump) writeFileSync(dump, serializeModule(lowered.module, true));
      return fail(validation.map((v) => iceDiag(v.message, v.loc)));
    }
    if (buildPlatform === "wasi") {
      const entryLoc: SrcLoc = { file: entryPath, start: 0, end: 0 };
      if (opts.sanitize) {
        return fail([targetRefusalDiag("wasm32-wasi", "--sanitize", entryLoc)]);
      }
      if (ffi !== null) {
        return fail([targetRefusalDiag("wasm32-wasi", "native FFI manifests", entryLoc)]);
      }
      fenceSpeculativeWasiFunctions(lowered.module);
      const unavailable = moduleWasiUnavailableSurface(lowered.module);
      if (unavailable !== null) {
        return fail([targetRefusalDiag("wasm32-wasi", unavailable.surface, unavailable.loc)]);
      }
    }
    sourceTexts = fe.sourceTexts();
  } finally {
    fe.dispose();
    timing("frontend-dispose");
  }

  return { ok: true, mod: lowered.module!, sourceTexts, stats: lowered.stats };
}
