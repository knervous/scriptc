// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import { setBatchRoots, setBrowserTarget, setLlvmLane, setWasmGcLane, setDefines, setHostModules, setHostModuleSchemes, setNativeDyn, setNativeAny, setHostHandles, setStripSourceSites, setSourcePathPrefixMap, setStrictHostModules, setInterfaceClassArms, setStrictFrontend } from "./frontend/browser-target.js";
import { collectFences } from "./release-fences.js";
import { compilationTiming, type CompilationTiming } from "./timing.js";
import { prepareExecutableModule } from "./executable/prepare.js";
import { prepareLibrary, libraryLocalizeSymbols, libraryWasmExports, libraryWasmRefusal } from "./library/prepare.js";
import { analyzeWithFrontend } from "./frontend/analysis.js";
import { llvmRefusalDiag, targetRefusalDiag } from "./backend/target-diagnostics.js";
import type { CompileBaseOptions, CompileOptions, CompileSourceOptions, CompileRequestOptions, CompileSourceResult, CompileResult, CompileExecutableResult, CompileRequestResult, CompileLibraryOptions, CompileLibraryResult, AnalyzeOptions, AnalyzeResult, WasmGcArtifactParts, WasmGcTransform, WasmGcTransformContext } from "./compile-types.js";
export type { WasmGcArtifactParts, WasmGcTransform, WasmGcTransformContext } from "./compile-types.js";
export type { CompileOutputKind, CompileBaseOptions, CompileOptions, CompileSourceOptions, CompileRequestOptions, CompileArtifact, CompileFailure, CompileSourceResult, CompileResult, CompileExecutableResult, CompileRequestResult, CompileLibraryOptions, CompileLibraryResult, AnalyzeOptions, AnalyzeResult } from "./compile-types.js";
import { compilePackedLibrary } from "./backend/library-pack.js";
import { InternalCompilerError } from "./errors.js";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { clearCcCaches, configuredTargetPlatform, type NativeArtifactDependency } from "./backend/native-toolchain.js";
import { buildCacheRoot, prepareBuildCacheRoot, pruneBuildCache } from "./backend/build-cache.js";
import {
  CcCompileError,
  compileExternalC,
  compileExternalCLibrary,
  executableNativeEnvironmentFingerprint,
  mobileLibraryTarget,
  mobileTargetRefusal,
  resolveCc,
} from "./backend/external-c.js";
import { emitLlvmModuleSource, LlvmUnsupportedError, lowRegionTarget, type LlvmTargetOptions } from "./backend/llvm/emitter.js";
import { inlineRcOption } from "./backend/llvm/shapes.js";
import { emitNativeArtifact, llvmInputBytes, NativeCodegenError } from "./backend/native-codegen.js";
import { nativeBuildPartitions, nativePartitionPaths } from "./backend/native-codegen-core.js";
import { privateSiblingPath } from "./backend/build-cache.js";
import { nativeCodegenTarget, nativeCodegenTargetRefusal } from "./backend/targets.js";
import { targetCpuField, targetCpuTargetRefusal } from "./backend/target-cpu.js";
import { windowsSubsystemLinkerArgs, type WindowsSubsystem } from "./backend/targets.js";
import type { NativeLinkFeatures } from "./backend/native-link-info.js";
import { createNativeLinkInfo } from "./backend/native-link-info.js";
import { RuntimePackError } from "./backend/runtime-pack.js";
import { createNativeLinkPlan } from "./backend/link-plan.js";
import {
  executableLinkerEnvironmentFingerprint,
  linkNativeExecutable,
  platformLinkerSupportsPersistentCache,
  resolvePlatformLinker,
} from "./backend/linker.js";
import { splitLlvmLibraryProgram, splitLlvmProgram } from "./backend/llvm/split.js";
import { emitLibraryIdentityLines, replaceLibraryIdentity, stripLibraryIdentity } from "./backend/library-identity-markers.js";
import { ffiNativeBuildDiag, iceDiag, nativeCodegenDiag, type ScrDiagnostic } from "./diagnostics/diagnostic.js";
import { loadLibraryProfile, type LibraryProfile } from "./library/library-profile.js";
import { clearFenceEvalCaches, decorateLibraryRefusals } from "./library/fence-eval.js";
import {
  canonicalModuleGraph,
  clearSidecarCaches,
  compilerReleaseVersion,
  libraryIdentityHashes,
  updateSidecarIdentity,
} from "./library/sidecar.js";
import { type IrModule, type SrcLoc } from "./ir/ir.js";
import { moduleFetchesNatively, moduleRuntimeFeatures } from "./ir/runtime-features.js";
import { hostReach } from "./backend/host-features.js";
import { checkClosedProfile } from "./backend/wasmgc/closed-profile.js";
import { indexSiteProfile, SiteProfileError, type SiteProfileIndex } from "./backend/wasmgc/site-profile.js";
import { DEFAULT_TARGETS, parseCapabilities, parseTargets, planVariants, preferredMode, VARIANTS_SCHEMA, type CapabilityMode, type CapabilityRequest, type Requirement, type VariantSet } from "./backend/wasmgc/capabilities.js";
import { emitWasmGcModule, WASMGC_HOST_ABI, WasmGcUnsupportedError, type WasmGcEmitResult, type WasmGcLink } from "./backend/wasmgc/emitter.js";
import { serializeModule } from "./ir/serialize.js";
import { validateModule } from "./ir/validate.js";
import { loadProgram } from "./frontend/program-node.js";
import { runFrontend, type FrontendFactory } from "./frontend/pipeline.js";
import { provenanceSources } from "./frontend/provenance-registry.js";
import { clearResolveCaches, setCompileConditions } from "./frontend/resolve.js";
import { loadFfiProfile, type FfiProfile } from "./ffi/ffi-manifest.js";
import { executableLinkFeatures } from "./backend/executable-features.js";
import { withRequiredLinkFeatures } from "./backend/native-link-info-core.js";
import { hostCacheIdentity, linksHostIsland, moduleCallsHost, type HostLinkOptions } from "./backend/host-island.js";
import { androidMainTarget, writeAndroidMainVersionScript } from "./backend/android-main.js";
import { FrontendInputTracker, trackedReadFile } from "./frontend/input-tracker.js";
import { libraryFrontendImplementationFingerprint, publishEarlyLibraryCache, readEarlyLibraryCache, readSemanticLibraryCache, type EarlyLibraryCacheOptions, type EarlyLibraryCachePublish, type EarlyLibraryNativeFeatures, type SemanticLibraryCacheHit } from "./library/library-cache.js";
import { publishEarlyExecutableCache, publishEarlyExecutableRoute, readEarlyExecutableCache, type EarlyExecutableCacheOptions, type EarlyExecutableNativeFeatures } from "./executable/executable-cache.js";
import { compilerImplementationIdentity } from "./library/compiler-self-identity.js";

export const VERSION = "0.0.1";

export {
  EXTERNAL_OBJECT_ABI_STABILITY,
  RUNTIME_ABI_MARKER,
  RUNTIME_ABI_VERSION,
} from "./backend/runtime-abi.js";
export type { NativeLinkInfo, NativeLinkFeatures } from "./backend/native-link-info.js";
export type { WindowsSubsystem } from "./backend/targets.js";

export * as capabilities from "./backend/wasmgc/capabilities.js";
export { InternalCompilerError } from "./errors.js";
export {
  compileExternalC as compileC,
  compileExternalC,
  runtimeSrcDir,
  type CcOptions,
  type NativeCacheWarmProfile,
  type WarmNativeCachesOptions,
  type WarmNativeCachesResult,
} from "./backend/external-c.js";
export { warmNativeCaches } from "./backend/warm-cache.js";
export { ANDROID_MIN_API, IPHONEOS_MIN_VERSION, isAndroidTarget, isIosTarget, isMobileTarget, mobileLibraryTarget, mobileTargetRefusal } from "./backend/external-c.js";
export { emitLlvmModule, type LlvmTargetOptions } from "./backend/llvm/emitter.js";
export type { ScrDiagnostic } from "./diagnostics/diagnostic.js";
export {
  renderDiagnostics,
  renderDiagnostics as renderAll,
  renderDiagnostic,
} from "./diagnostics/render.js";
export { renderCoverage, type CoverageInput } from "./coverage/report.js";
export {
  generateSurfaceManifest,
  renderSurfaceManifest,
  MANIFEST_SCHEMA_VERSION,
  type SurfaceManifest,
  type SurfaceManifestEntry,
} from "./coverage/surface-manifest.js";
export {
  NODE24_FETCH_COMPAT_PROFILE,
  type FetchCompatEvidence,
  type FetchCompatFacet,
  type FetchCompatInventory,
  type FetchCompatInventoryEntry,
  type FetchCompatInventoryExclusion,
  type FetchCompatInventoryPlacement,
  type FetchCompatInventoryStatus,
  type FetchCompatOperation,
  type FetchCompatOption,
  type FetchCompatProfile,
} from "./compat/fetch-profile.js";
export { validateModule } from "./ir/validate.js";
export { libFnSignatures } from "./ir/builtin-signatures.js";
export { deserializeModule, IR_VERSION, serializeModule } from "./ir/serialize.js";
export { resolveLibraryFences, type LibraryFenceDecl, type ResolvedLibraryFence } from "./library/fence-eval.js";
export {
  loadLibraryProfile,
  profileTeaching,
  profileRemediation,
  LIB_PARAM_CLASSES,
  LIB_RETURN_CLASSES,
  type LibraryProfile,
  type LibraryExportEntry,
  type LibrarySidecarConfig,
  type LibParamClass,
  type LibReturnClass,
} from "./library/library-profile.js";
export {
  loadFfiProfile,
  FFI_CALLBACK_PARAM_CLASSES,
  FFI_PARAM_CLASSES,
  FFI_RETURN_CLASSES,
  type FfiCallbackParam,
  type FfiCallbackParamClass,
  type FfiContextParam,
  type FfiFunction,
  type FfiParamClass,
  type FfiProfile,
  type FfiReturnClass,
  type FfiValueParamClass,
} from "./ffi/ffi-manifest.js";
export {
  assembleTrapTeaching,
  TRAP_TEACHING_MARKER,
  TRAP_TEACHING_SEP,
} from "./library/trap-teaching.js";
export {
  abiExportSuffixes,
  buildSidecar,
  canonicalModuleGraph,
  canonicalPath,
  compilerReleaseVersion,
  libraryIdentityHashes,
  SIDECAR_FORMAT,
  type SidecarDoc,
  type SidecarBuildInput,
  type SidecarBuildResult,
  type TypeRef,
  type PayloadDescriptor,
} from "./library/sidecar.js";
export { validateSidecar } from "./library/sidecar-validate.js";
export { BUILD_ID_SEED, SOURCE_HASH_SEED, hex16, lengthPrefixedStream, wyhash64 } from "./library/wyhash.js";
export { ISLAND_SURFACE, STATIC_MATH_PROPS, type IslandFnEntry } from "./frontend/lowering/surfaces.js";
export { ambientDtsPath, isExactExternalTypeSpecifier, overridesDtsPath } from "./frontend/program-node.js";
export { resolveProvenanceSources } from "./frontend/provenance.js";
export { wasiGuestPath, type HostPathFlavor } from "./wasi-paths.js";
export {
  setProvenanceSources,
  type ProvenancePackageSource,
  type ProvenanceSources,
} from "./frontend/provenance-registry.js";
export * as ir from "./ir/ir.js";

/** Clang may print every warning from the generated/runtime translation
 * units before the actionable linker failure. Keep the source diagnostic
 * precise by starting at the first portable linker marker; if the driver
 * supplied no recognizable marker, retain only its bounded tail. */
function ffiNativeBuildDetail(err: CcCompileError): string {
  const lines = err.stderr.trim().split(/\r?\n/);
  const linkerMarker = lines.findIndex((line) =>
    /(?:Undefined symbols|undefined reference to|unresolved external symbol|duplicate symbol|library not found for|cannot find -l|unable to find library|file format not recognized|linker command failed|fatal error LNK|lld-link: error)/i.test(line)
  );
  const relevant = linkerMarker >= 0 ? lines.slice(linkerMarker) : lines.slice(-40);
  const output = relevant.join("\n").trim();
  return (
    `${err.driver} ${linkerMarker >= 0 ? "could not link the generated program" : "failed while building the generated program"}` +
    (output.length > 0 ? `:\n${output}` : "")
  );
}

/** Platform semantics depend on the output target, without compiler discovery. */
export function buildTargetPlatform(env: NodeJS.ProcessEnv = process.env): string {
  return configuredTargetPlatform(env);
}

/** Target-platform classification without compiler or SDK discovery. Source
 * artifacts need target semantics for lowering, but do not need a native
 * toolchain merely to decide whether that target is Windows, WASI, etc. */
export function sourceTargetPlatform(env: NodeJS.ProcessEnv = process.env): string {
  return configuredTargetPlatform(env);
}

/** SCRIPTC_STRICT_FRONTEND: `strictFrontend` for a build whose script cannot pass it ("1" for `true`, or the option
 * object as JSON). An explicit option wins. */
function strictFrontendFromEnv(): CompileBaseOptions["strictFrontend"] {
  const raw = process.env["SCRIPTC_STRICT_FRONTEND"];
  if (raw === undefined || raw === "" || raw === "0") return undefined;
  if (raw === "1" || raw === "true") return true;
  return JSON.parse(raw) as CompileBaseOptions["strictFrontend"];
}

export function analyze(entryPath: string, opts: AnalyzeOptions = {}): AnalyzeResult {
  const browser = opts.browser === true;
  setBrowserTarget(browser);
  setLlvmLane(false);
  setWasmGcLane(false);
  setHostModules([]);
  setHostModuleSchemes(undefined);
  setNativeDyn(browser && opts.dynModel === "native");
  setNativeAny(browser && opts.dynModel === "native" && opts.experimentalTsNativeAny === true);
  setInterfaceClassArms(opts.interfaceClassArms ?? browser);
  setStrictFrontend(opts.strictFrontend ?? strictFrontendFromEnv());
  setCompileConditions(opts.conditions ?? []);
  return analyzeWithFrontend(entryPath, browser ? { ...opts, dynamic: true } : opts, buildTargetPlatform(), nodeFrontend);
}

const nodeFrontend: FrontendFactory = (entry, npmStatic, externalTypes, libraryNpmStatic) =>
  runFrontend(entry, loadProgram, npmStatic, externalTypes, libraryNpmStatic);

/** The whole pipeline: load → preflight → lower → validate → emit LLVM → link. */
function clearCompileSessionCaches(): void {
  clearResolveCaches();
  clearCcCaches();
  clearSidecarCaches();
  clearFenceEvalCaches();
}

export function compile(
  entryPath: string,
  opts: CompileSourceOptions,
): Promise<CompileSourceResult>;
export function compile(
  entryPath: string,
  opts: CompileOptions,
): Promise<CompileExecutableResult>;
export function compile(entryPath: string, opts: CompileRequestOptions): Promise<CompileRequestResult>;
export async function compile(entryPath: string, opts: CompileRequestOptions): Promise<CompileRequestResult> {
  clearCompileSessionCaches();
  // Browser target: DOM through the page's engine as the island (implies dynamic).
  const browser = Boolean((opts as { browser?: boolean }).browser);
  setBrowserTarget(browser);
  {
    const kind = (opts as { outputKind?: string }).outputKind;
    setLlvmLane(kind === undefined || kind === "exe" || kind === "obj" || kind === "llvm" || kind === "asm");
    setWasmGcLane(kind === "wasmgc");
  }
  setHostModules((opts as { hostModules?: readonly string[] }).hostModules ?? []);
  setNativeDyn(browser && (opts as { dynModel?: string }).dynModel === "native");
  setNativeAny(browser && opts.dynModel === "native" && opts.experimentalTsNativeAny === true);
  setHostHandles(browser && opts.dynModel === "native" && opts.hostHandles === true);
  setStripSourceSites(opts.stripSourceSites === true);
  setSourcePathPrefixMap(opts.sourcePathPrefixMap ?? []);
  setStrictHostModules(opts.strictHostModules === true);
  setHostModuleSchemes(opts.hostModuleSchemes);
  // Class arms are the WasmGC lanes' structural-type model (browser or not): without them a class instance entering a
  // record type is a width copy, which declines a type the class satisfies through a method.
  setInterfaceClassArms(opts.interfaceClassArms ?? (browser || opts.outputKind === "wasmgc"));
  setStrictFrontend(opts.strictFrontend ?? strictFrontendFromEnv());
  // Constructor structs are on by default wherever they apply (a project decision, 2026-10-16: both gates clean, ~15% on
  // compiled React, every generic operation keeps JS semantics); `experimentalJsConstructorStructs: false` opts out.
  if (opts.experimentalJsConstructorStructs === undefined && browser && opts.dynModel === "native" && opts.outputKind === "wasmgc"
    && !(opts as { wasmLink?: WasmGcLink }).wasmLink?.sharedRuntime)
    opts = { ...opts, experimentalJsConstructorStructs: true };
  {
    // define: validated up front (a free dotted name to a JSON literal).
    const table = new Map<string, string | number | boolean | null>();
    for (const [key, text] of Object.entries(opts.define ?? {})) {
      let value: unknown;
      try { value = JSON.parse(text); } catch { value = undefined; }
      if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(key) || !(value === null || ["string", "number", "boolean"].includes(typeof value)))
        return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", `define: '${key}' must be a dotted name mapped to the JSON text of a string, number, boolean or null`, entryPath)], sourceTexts: new Map() };
      table.set(key, value as string | number | boolean | null);
    }
    setDefines(table);
  }
  if ((opts.conditions ?? []).some((c) => typeof c !== "string" || !/^[\w.:-]+$/.test(c) || ["types", "import", "require", "default", "node"].includes(c)))
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "conditions: each must be a plain condition name other than the defaults (types, import, require, default, node)", entryPath)], sourceTexts: new Map() };
  setCompileConditions(opts.conditions ?? []);
  // An object (outputKind "ir" with objectUnit), or IR handed to an in-process emitter (objectIrSink), is WasmGC output too.
  // SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY=1: the LLVM lane takes native-any too (the native host island experiment).
  const llvmNativeAny = process.env["SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY"] === "1" && (opts.outputKind === "obj" || opts.outputKind === "exe" || opts.outputKind === "llvm" || opts.outputKind === undefined);
  if (opts.experimentalTsNativeAny && !llvmNativeAny && (!browser || opts.dynModel !== "native" || (opts.outputKind !== "wasmgc" && !(opts.outputKind === "ir" && (opts.objectUnit || opts.objectIrSink)))))
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "experimentalTsNativeAny requires browser native WasmGC", entryPath)], sourceTexts: new Map() };
  if (opts.experimentalOpaquePageExpandos && (!browser || opts.dynModel !== "native" || opts.outputKind !== "wasmgc"))
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "experimentalOpaquePageExpandos requires browser native WasmGC", entryPath)], sourceTexts: new Map() };
  if (opts.experimentalDynInlineSlots !== undefined && opts.experimentalDynInlineSlots !== 0 && (!browser || opts.dynModel !== "native" || opts.outputKind !== "wasmgc"
    || !Number.isInteger(opts.experimentalDynInlineSlots) || opts.experimentalDynInlineSlots < 0 || opts.experimentalDynInlineSlots > 16))
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "experimentalDynInlineSlots needs browser native WasmGC and an integer 0..16", entryPath)], sourceTexts: new Map() };
  if (opts.experimentalDomMirror && (!browser || opts.dynModel !== "native" || opts.outputKind !== "wasmgc" || (opts as { wasmLink?: WasmGcLink }).wasmLink?.sharedRuntime))
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "experimentalDomMirror requires browser native WasmGC without a shared runtime", entryPath)], sourceTexts: new Map() };
  // The mirror's "is a compiled value" test knows only the module's own types; the native host's own types (host strings, node handles)
  // would be misclassified as compiled values, a silent wrong-result path.
  if (opts.experimentalDomMirror && opts.hostHandles)
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "experimentalDomMirror cannot be combined with hostHandles: the mirror's compiled-value test cannot tell host-owned values (strings, node handles) from compiled ones", entryPath)], sourceTexts: new Map() };
  if (opts.experimentalDynI31 && (!browser || opts.dynModel !== "native" || opts.outputKind !== "wasmgc"))
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "experimentalDynI31 requires browser native WasmGC", entryPath)], sourceTexts: new Map() };
  if (opts.experimentalJsConstructorStructs && (!browser || opts.dynModel !== "native" || opts.outputKind !== "wasmgc"))
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "experimentalJsConstructorStructs requires browser native WasmGC", entryPath)], sourceTexts: new Map() };
  if (opts.experimentalRelaxedSimd && opts.outputKind !== "wasmgc")
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "experimentalRelaxedSimd requires WasmGC output", entryPath)], sourceTexts: new Map() };
  setBatchRoots(process.env.SCRIPTC_SHARE_TS7_HOST === "1" ? (opts as { batchRoots?: readonly string[] }).batchRoots ?? null : null);
  if (browser) opts = { ...opts, dynamic: true };
  const frontendInputs = new FrontendInputTracker();
  return frontendInputs.run(() => compileTracked(entryPath, opts, frontendInputs));
}

/** Build-time API compatibility fence: a caller's existing CompileOptions
 * variable must retain the executable result aliases without narrowing. */
async function assertCompileOptionsCompatibility(
  entryPath: string,
  opts: CompileOptions,
): Promise<void> {
  const result = await compile(entryPath, opts);
  if (result.ok) {
    const binaryPath: string = result.binaryPath;
    void binaryPath;
  }
}
void assertCompileOptionsCompatibility;

/** The historical exported CompileResult itself remains executable-shaped. */
function assertCompileResultCompatibility(result: CompileResult): void {
  if (result.ok) {
    const binaryPath: string = result.binaryPath;
    void binaryPath;
  }
}
void assertCompileResultCompatibility;

function executableNativeFeatures(
  mod: IrModule,
  backend: "llvm",
  dynamic: boolean,
  optimization: "release" | "dev",
  hostIsland = false,
): EarlyExecutableNativeFeatures {
  const link = executableLinkFeatures(mod, dynamic || hostIsland);
  return {
    backend,
    ...(optimization === "dev" ? { optimization: "dev" as const } : {}),
    // The host island answers the page in place of the engine island
    // (host-island.ts); the requirement table turns on what it links with.
    // Its `fetch` is the host's too: the runtime's fetch unit links only for a static fetch (moduleFetchesNatively).
    ...(hostIsland ? withRequiredLinkFeatures({ ...link, fetch: moduleFetchesNatively(mod), hostIsland: true }) : link),
    // The host services the program reaches, for the host pack's set (host-features.ts).
    ...(hostIsland ? { hostReach: hostReach(mod) } : {}),
  };
}

/** The host options of a compile (host-island.ts). */
function hostLinkOptions(opts: CompileRequestOptions): HostLinkOptions {
  return {
    ...(opts.host === undefined ? {} : { host: opts.host }),
    ...(opts.hostLib === undefined ? {} : { hostLib: opts.hostLib }),
    ...(opts.hostLinkArgs === undefined ? {} : { hostLinkArgs: opts.hostLinkArgs }),
    ...(opts.hostFeatures === undefined ? {} : { hostFeatures: opts.hostFeatures }),
    ...(opts.explainHost === true ? { explainHost: true } : {}),
  };
}

/** The link features of an executable build, without the cache's backend and posture keys. */
function linkFeatureOptions(features: EarlyExecutableNativeFeatures): NativeLinkFeatures {
  const { backend: _backend, optimization: _optimization, hostReach: _hostReach, ...link } = features;
  return link;
}

/** The emitter options upstream's driver passes for an executable's code
 * (and for textual output, which shows that code): sanitizer attributes,
 * the low allocator window, inline refcount fast paths for optimized
 * builds, the start-up section and the x86-64-v3 copies of --cpu-dispatch. */
function nativeEmissionOptions(
  opts: CompileRequestOptions,
  buildPlatform: string,
): Partial<LlvmTargetOptions> {
  const sanitize = opts.sanitize === true;
  return {
    objectAudit: sanitize,
    sanitizeAttributes: sanitize,
    lowRegion: lowRegionTarget(buildPlatform, sanitize),
    startupSection: buildPlatform === "linux",
    ...inlineRcOption(opts.optimization, sanitize),
    ...(opts.cpuDispatch === true ? { cpuDispatch: true } : {}),
    ...targetCpuField(opts.targetCpu),
  };
}

async function compileExecutableNative(
  features: EarlyExecutableNativeFeatures,
  llvmPath: string,
  outPath: string,
  sanitize: boolean,
  ffi: FfiProfile | null,
  windowsSubsystem?: WindowsSubsystem,
  strip?: boolean,
  programSplit: ReturnType<typeof splitLlvmProgram> = null,
  programObjectDependencies: readonly NativeArtifactDependency[] = [],
  onArtifactReady?: NonNullable<Parameters<typeof compileExternalC>[0]["onArtifactReady"]>,
  programPartitions: readonly string[] = [],
  host: HostLinkOptions = {},
  androidMain = false,
): Promise<void> {
  const programIsObject = /\.(?:o|obj)$/.test(llvmPath);
  const codegenTarget = programIsObject && !sanitize
    ? nativeCodegenTarget()
    : null;
  if (androidMain && codegenTarget === null) {
    throw new RuntimePackError(
      "the android-main output links against the precompiled Android runtime pack; this build compiles the runtime from source (--sanitize)",
      "unsupported",
    );
  }
  // android-main: the NDK's clang links one shared library (android-main.ts).
  const versionScript = androidMain ? `${outPath}.version-script` : null;
  const runtimePackTarget = codegenTarget !== null && versionScript !== null
    ? androidMainTarget(codegenTarget, await writeAndroidMainVersionScript(versionScript), process.env, features.hostIsland === true)
    : codegenTarget;
  if (runtimePackTarget !== null) {
    try {
    const { hostReach: reach, ...linkFeatures } = features;
    const plan = await createNativeLinkPlan({
      target: runtimePackTarget,
      programObject: llvmPath,
      programPartitions,
      outPath,
      features: linkFeatures,
      ffi,
      optimization: features.optimization ?? "release",
      ...(strip ? { strip: true } : {}),
      ...(windowsSubsystem === undefined ? {} : { windowsSubsystem }),
      programObjectDependencies,
      host: reach === undefined ? host : { ...host, reach },
    });
    const cacheableLinker =
      onArtifactReady !== undefined && ffi === null && platformLinkerSupportsPersistentCache(
        process.env,
        runtimePackTarget,
      );
    await linkNativeExecutable(plan, {
      // A caller-selected linker can be a mutable wrapper with hidden inputs,
      // and a PATH-selected `clang` can be one too. FFI profiles and mutable
      // linker search environments likewise name transitive files that the
      // top-level dependency snapshot cannot prove. Only a direct driver in a
      // stable link environment may publish a reusable final executable.
      ...(cacheableLinker ? { onArtifactReady } : {}),
    });
    return;
    } finally {
      if (versionScript !== null) await rm(versionScript, { force: true });
    }
  }
  const effectiveProgramSplit =
    programSplit ??
    (!programIsObject && features.optimization === "dev" && features.backend === "llvm" && !sanitize
      ? splitLlvmProgram(await readFile(llvmPath, "utf8"))
      : null);
  if (programIsObject) throw new InternalCompilerError("program objects must link against a precompiled runtime pack");
  // The source-TU link (sanitized builds, the curl reference) compiles the
  // runtime from source; it has no host-island route yet.
  if (features.hostIsland === true) {
    throw new RuntimePackError(
      "the host island links only against a precompiled runtime pack; this build compiles the runtime from source (--sanitize)",
      "unsupported",
      "build without --sanitize, or with --host=quickjs",
    );
  }
  await compileExternalC({
      cPath: llvmPath,
      outPath,
      cacheIdentity: "scriptc-generated-v1",
      ...(features.optimization === "dev" ? { optimization: "dev" as const } : {}),
      ...(strip ? { strip: true } : {}),
      ...(windowsSubsystem === undefined ? {} : { windowsSubsystem }),
      ...(effectiveProgramSplit === null
        ? {}
        : {
            programShards: effectiveProgramSplit.shards,
            programPublicSymbols: effectiveProgramSplit.publicSymbols,
          }),
      sanitize,
      ...linkFeatureOptions(features),
      ...(onArtifactReady === undefined ? {} : { onArtifactReady }),
      ...(ffi === null ? {} : { linkInputs: ffi.libraries, systemLibraries: ffi.systemLibraries, frameworks: ffi.frameworks }),
    });
}

/** The program object the native helper compiled, with the further
 * partition objects linked after it. */
interface NativeProgramObject {
  linkPath: string;
  artifactPath: string;
  dependencies: NativeArtifactDependency[];
  partitionPaths: string[];
}

async function removeNativeProgramObject(
  linkPath: string,
  partitionPaths: readonly string[],
): Promise<void> {
  await Promise.all(
    [linkPath, ...partitionPaths].map((path) => rm(path, { force: true }).catch(() => undefined)),
  );
}

async function emitNativeProgramObject(
  entryPath: string,
  opts: CompileRequestOptions,
  llvm: string | readonly string[],
): Promise<NativeProgramObject> {
  const stem = basename(entryPath).replace(/\.(ts|mts|cts|js|mjs|cjs)$/, "");
  const artifactPath = join(opts.outDir, `${stem}.helper.o`);
  // compileExecutableNative recognizes object inputs by suffix. The random
  // private name isolates concurrent builds; retain .o so the driver links
  // it rather than attempting to compile it as source.
  const linkPath = `${privateSiblingPath(artifactPath, "native-program-object")}.o`;
  // The helper compiles the module in partitions it links together (the
  // ThinLTO-style split, native-codegen-core.ts); the validated
  // program-object artifact is a single object by contract.
  const partitions = nativeBuildPartitions(llvmInputBytes(llvm), {
    singleObject: opts.nativeProgramObject === true || nativeCodegenTarget() === null,
    cpuDispatch: opts.cpuDispatch === true,
    unoptimized: opts.optimization === "dev",
  });
  try {
    const artifact = await emitNativeArtifact({
      outputPath: linkPath,
      llvm,
      outputKind: "obj",
      sourcePath: entryPath,
      optimization: opts.optimization === "dev" ? "0" : "2",
      ...(opts.sanitize === undefined ? {} : { sanitize: opts.sanitize }),
      partitions,
    });
    return {
      linkPath,
      artifactPath,
      dependencies: artifact.dependencies,
      partitionPaths: artifact.outputPaths.slice(1),
    };
  } catch (error) {
    await removeNativeProgramObject(linkPath, nativePartitionPaths(linkPath, partitions).slice(1));
    throw error;
  }
}

function usesPrecompiledRuntimePack(
  opts: CompileRequestOptions,
  backend: "llvm",
): boolean {
  if (
    backend !== "llvm" || opts.sanitize === true ||
    process.env["SCRIPTC_FETCH_CURL"] === "1"
  ) return false;
  return nativeCodegenTarget() !== null;
}

function runtimePackDiagnostic(error: RuntimePackError, entryPath: string): ScrDiagnostic {
  return nativeCodegenDiag(error.code === "unsupported" ? "SC3002" : "SC3003", error.message, entryPath, error.hint);
}

interface PreparedExecutable {
  llvmSource: string | readonly string[];
  llvmPath: string;
  irPath: string | undefined;
  nativeFeatures: EarlyExecutableNativeFeatures;
  programSplit: ReturnType<typeof splitLlvmProgram>;
  sourceTexts: Map<string, string>;
}

/** Finish frontend work in a separate scope so the AST, checker caches and
 * typed IR can be reclaimed before the native optimizer needs its heap. */
async function prepareExecutableInput(
  entryPath: string, opts: CompileRequestOptions, ffi: FfiProfile | null, buildPlatform: string,
  timing: CompilationTiming,
): Promise<PreparedExecutable | CompileRequestResult> {
  const outputKind = opts.outputKind ?? "exe";
  const prepared = prepareExecutableModule(entryPath, opts, ffi, buildPlatform, nodeFrontend, timing);
  if (!prepared.ok) return prepared;
  const { mod, sourceTexts } = prepared;

  const stem = basename(entryPath).replace(/\.(ts|mts|cts|js|mjs|cjs)$/, "");
  const defaultSourcePaths = {
    ir: join(opts.outDir, `${stem}.ir.json`),
    llvm: join(opts.outDir, `${stem}.ll`),
  } as const;
  const debugOptions = opts.optimization === "dev" && !opts.strip
    ? { debugSources: sourceTexts }
    : {};

  if (outputKind === "ir") {
    if (opts.objectIrSink) { opts.objectIrSink(mod); return { ok: true, artifact: { kind: "ir", path: opts.outPath } }; }
    await mkdir(dirname(opts.outPath), { recursive: true });
    await writeFile(opts.outPath, serializeModule(mod, true));
    return { ok: true, artifact: { kind: "ir", path: opts.outPath } };
  }

  if (opts.experimentalJsSpecializeProperties !== undefined && opts.experimentalJsSpecialize !== "guarded")
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "specialization property selection requires guarded mode", entryPath)], sourceTexts };
  if (opts.experimentalJsSpecializeCounters && opts.experimentalJsSpecialize !== "guarded" && opts.experimentalJsSpecialize !== "profile")
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "specialization counters require guarded or profile mode", entryPath)], sourceTexts };
  if (opts.experimentalJsSpecializeProperties !== undefined && (!Array.isArray(opts.experimentalJsSpecializeProperties) || opts.experimentalJsSpecializeProperties.some(p => typeof p !== "string" || !p.length)))
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "specialization properties must be an array of nonempty strings", entryPath)], sourceTexts };
  if (opts.experimentalJsSpecialize !== undefined && (opts.experimentalJsSpecialize !== "guarded" && opts.experimentalJsSpecialize !== "closed" && opts.experimentalJsSpecialize !== "profile" || outputKind !== "wasmgc" || !opts.browser || opts.dynModel !== "native"))
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "experimentalJsSpecialize requires guarded, closed or profile mode on browser native WasmGC", entryPath)], sourceTexts };
  if (opts.experimentalJsSpecializeCoverage !== undefined && opts.experimentalJsSpecialize !== "profile")
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "experimentalJsSpecializeCoverage requires profile mode", entryPath)], sourceTexts };
  if ((opts.experimentalJsSpecialize === "profile") !== (typeof opts.experimentalJsSpecializeProfile === "string" && opts.experimentalJsSpecializeProfile.length > 0))
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "experimentalJsSpecialize \"profile\" and experimentalJsSpecializeProfile (a site profile path) go together", entryPath)], sourceTexts };
  let profileSites: SiteProfileIndex | undefined;
  if (opts.experimentalJsSpecialize === "profile") {
    const profilePath = resolve(opts.experimentalJsSpecializeProfile!);
    let json: string;
    try { json = await readFile(profilePath, "utf8"); }
    catch (err) { return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", `cannot read site profile ${profilePath}: ${(err as Error).message}`, entryPath)], sourceTexts }; }
    // The text the compiler read for a file, else what is on disk now.
    const onDisk = (file: string): string | undefined => { try { return readFileSync(file, "utf8"); } catch { return undefined; } };
    try { profileSites = indexSiteProfile(json, profilePath, file => sourceTexts.get(file) ?? onDisk(file), resolve(entryPath), opts.experimentalJsSpecializeCoverage); }
    catch (err) {
      if (!(err instanceof SiteProfileError)) throw err;
      return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", err.message, entryPath)], sourceTexts };
    }
  }

  if (opts.experimentalJsSpecialize === "closed") {
    const closed = checkClosedProfile(mod, opts.wasmLink?.exports ?? []);
    await mkdir(dirname(opts.outPath), { recursive: true });
    await writeFile(`${opts.outPath}.closed.json`, JSON.stringify(closed, null, 2) + "\n");
    if (!closed.admitted) {
      await rm(opts.outPath, { force: true });
      return { ok: false, sourceTexts, diagnostics: closed.refusals.map(f => ({ ...nativeCodegenDiag("SC3002", f.message, entryPath), ...(f.loc ? {loc: f.loc} : {}) })) };
    }
  } else await rm(`${opts.outPath}.closed.json`, { force: true });

  if (outputKind === "wasmgc") return emitWasmGcArtifacts(mod, opts, entryPath, sourceTexts, profileSites);

  if (outputKind === "llvm" || outputKind === "asm" || outputKind === "obj") {
    let llvm: string | readonly string[];
    try {
      llvm = emitLlvmModuleSource(mod, {
        targetTriple: process.env["SCRIPTC_TARGET"] ?? "",
        ...debugOptions,
        pointerBits: buildPlatform === "wasi" ? 32 : 64,
        wasi: buildPlatform === "wasi",
        ...nativeEmissionOptions(opts, buildPlatform),
        // Textual output shows the code an executable gets; objects keep
        // the pending flag, since their link may not add an unwinder.
        unwindAbi: buildPlatform === "linux" && outputKind !== "obj",
        runtimeAbiMarker: outputKind === "obj",
        ...(opts.nativeEntry !== undefined ? { nativeEntry: opts.nativeEntry } : {}),
        ...(opts.nativeExports !== undefined ? { nativeExports: opts.nativeExports } : {}),
      });
    } catch (err) {
      if (!(err instanceof LlvmUnsupportedError)) throw err;
      return { ok: false, diagnostics: [llvmRefusalDiag(err, entryPath)], sourceTexts };
    }
    if (outputKind === "llvm") {
      await mkdir(dirname(opts.outPath), { recursive: true });
      await writeFile(opts.outPath, llvm);
    } else {
      try {
        await emitNativeArtifact({
          outputPath: opts.outPath,
          llvm,
          outputKind,
          sourcePath: entryPath,
          optimization: opts.optimization === "dev" ? "0" : "2",
          ...(opts.sanitize === undefined ? {} : { sanitize: opts.sanitize }),
        });
      } catch (err) {
        if (!(err instanceof NativeCodegenError)) throw err;
        return {
          ok: false,
          diagnostics: [nativeCodegenDiag(err.diagnosticCode, err.message, entryPath)],
          sourceTexts,
        };
      }
    }
    if (outputKind === "obj" && opts.nativeLinkInfo === true) {
      const target = nativeCodegenTarget();
      if (target === null) {
        throw new InternalCompilerError("native object emitted without a native target");
      }
      return {
        ok: true,
        artifact: {
          kind: "obj",
          path: opts.outPath,
          nativeLinkInfo: await createNativeLinkInfo({
            programObject: opts.outPath,
            target,
            features: executableNativeFeatures(
              mod,
              "llvm",
              opts.dynamic ?? false,
              opts.optimization ?? "release",
            ),
            ffi,
            optimization: opts.optimization ?? "release",
          }),
        },
      };
    }
    return { ok: true, artifact: { kind: outputKind, path: opts.outPath } };
  }

  await mkdir(opts.outDir, { recursive: true });
  const llvmPath = defaultSourcePaths.llvm;
  const backend = "llvm" as const;
  const useRuntimePack = opts.nativeProgramObject === true || usesPrecompiledRuntimePack(opts, backend);
  let llvmSource: string | readonly string[];
  try {
    llvmSource = emitLlvmModuleSource(mod, {
      targetTriple: process.env["SCRIPTC_TARGET"] ?? "",
      ...debugOptions,
      pointerBits: buildPlatform === "wasi" ? 32 : 64,
      wasi: buildPlatform === "wasi",
      runtimeAbiMarker: useRuntimePack,
      ...nativeEmissionOptions(opts, buildPlatform),
      ...(linksHostIsland({ browser: opts.browser === true, callsHost: moduleCallsHost(mod), ...hostLinkOptions(opts) })
        ? { hostIsland: true }
        : {}),
      unwindAbi: buildPlatform === "linux",
      ...(opts.nativeEntry !== undefined ? { nativeEntry: opts.nativeEntry } : {}),
      ...(opts.nativeExports !== undefined ? { nativeExports: opts.nativeExports } : {}),
    });
  } catch (err) {
    if (!(err instanceof LlvmUnsupportedError)) throw err;
    return { ok: false, diagnostics: [llvmRefusalDiag(err, entryPath)], sourceTexts };
  }
  timing("llvm-emit");
  await writeFile(llvmPath, llvmSource);
  timing("llvm-write");
  let irPath: string | undefined;
  if (opts.emitIr) {
    irPath = defaultSourcePaths.ir;
    await writeFile(irPath, serializeModule(mod, true));
  }

  const nativeFeatures = executableNativeFeatures(
    mod,
    backend,
    opts.dynamic ?? false,
    opts.optimization ?? "release",
    linksHostIsland({ browser: opts.browser === true, callsHost: moduleCallsHost(mod), ...hostLinkOptions(opts) }),
  );
  timing("link-features");
  const programSplit =
    !useRuntimePack && backend === "llvm" && (opts.optimization ?? "release") === "dev" &&
      !(opts.sanitize ?? false) && typeof llvmSource === "string"
      ? splitLlvmProgram(llvmSource)
      : null;
  timing("llvm-split");
  return { llvmSource, llvmPath, irPath, nativeFeatures, programSplit, sourceTexts };
}

async function compileTracked(
  entryPath: string,
  opts: CompileRequestOptions,
  frontendInputs: FrontendInputTracker,
): Promise<CompileRequestResult> {
  const timing = compilationTiming();
  entryPath = resolve(entryPath);
  const outputKind = opts.outputKind ?? "exe";
  if ((opts.backend !== undefined && opts.backend !== "llvm") ||
      !["ir", "wasmgc", "llvm", "asm", "obj", "exe"].includes(outputKind)) {
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "supported outputs are ir, wasmgc, llvm, asm, obj, and exe", entryPath)], sourceTexts: new Map() };
  }
  if (opts.windowsSubsystem !== undefined && outputKind !== "exe") {
    return {
      ok: false,
      diagnostics: [nativeCodegenDiag("SC3002", "--windows-subsystem is only supported for executable output", entryPath)],
      sourceTexts: new Map(),
    };
  }
  if (opts.strip === true && outputKind !== "exe") {
    return {
      ok: false,
      diagnostics: [nativeCodegenDiag("SC3002", "--strip is only supported for executable output", entryPath)],
      sourceTexts: new Map(),
    };
  }
  if (opts.nativeLinkInfo === true && outputKind !== "obj") {
    return {
      ok: false,
      diagnostics: [nativeCodegenDiag(
        "SC3002",
        "native link info is available only for object output",
        entryPath,
      )],
      sourceTexts: new Map(),
    };
  }
  if (opts.nativeProgramObject === true &&
      (outputKind !== "exe" || opts.backend !== "llvm")) {
    return {
      ok: false,
      diagnostics: [nativeCodegenDiag(
        "SC3002",
        "native program-object validation requires an executable build with backend explicitly set to llvm",
        entryPath,
      )],
      sourceTexts: new Map(),
    };
  }
  // Mobile triples are library-mode targets: the archive an embedding app
  // links is the artifact, and only the library-admissible runtime surface
  // is verified on those device classes. The executable lane refuses before
  // any frontend work — a pure env check, so the refusal needs no toolchain.
  if (outputKind === "exe") {
    const entryLoc: SrcLoc = { file: entryPath, start: 0, end: 0 };
    const mobileTarget = mobileLibraryTarget();
    const androidMain = opts.nativeOutput === "android-main";
    if (androidMain && !(mobileTarget !== null && /^aarch64-(?:unknown-)?linux-android/.test(mobileTarget))) {
      return {
        ok: false,
        diagnostics: [{ code: "SC3002", message: "the android-main output needs SCRIPTC_TARGET=aarch64-linux-android", loc: entryLoc }],
        sourceTexts: new Map(),
      };
    }
    if (mobileTarget !== null && !androidMain) {
      return {
        ok: false,
        diagnostics: [
          targetRefusalDiag(
            mobileTarget,
            "standalone executable builds — mobile targets produce library-mode static archives (scriptc build --lib --profile <profile.json>) for an embedding app to link",
            entryLoc,
          ),
        ],
        sourceTexts: new Map(),
      };
    }
    const rawTarget = process.env["SCRIPTC_TARGET"] ?? "";
    const mobileRefusal = mobileTargetRefusal(rawTarget);
    if (mobileRefusal !== null && !androidMain) {
      return {
        ok: false,
        diagnostics: [{ code: "SC3002", message: mobileRefusal, loc: entryLoc }],
        sourceTexts: new Map(),
      };
    }
  }
  if (outputKind === "exe" && opts.sanitize !== true && process.env["SCRIPTC_FETCH_CURL"] !== "1") {
    const refusal = nativeCodegenTargetRefusal();
    if (refusal !== null) return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", refusal, entryPath)], sourceTexts: new Map() };
  }
  let ffi: FfiProfile | null = null;
  let ffiProfileBytes: Uint8Array | null = null;
  if (opts.ffiProfilePath !== undefined) {
    const ffiProfilePath = resolve(opts.ffiProfilePath);
    const loaded = loadFfiProfile(ffiProfilePath);
    if (!loaded.ok) {
      return { ok: false, diagnostics: loaded.diagnostics, sourceTexts: new Map() };
    }
    ffi = loaded.profile;
    ffiProfileBytes = loaded.profileBytes;
  }
  let buildPlatform: string;
  if (outputKind === "exe") {
    // Target semantics are needed before choosing the helper/runtime-pack
    // path. Do not make them contingent on the legacy C-driver resolver:
    // an LLVM-owned WASI build deliberately needs no SCRIPTC_CC.
    try {
      buildPlatform = sourceTargetPlatform();
    } catch (err) {
      return {
        ok: false,
        diagnostics: [{
          code: "SC3002",
          message: err instanceof Error ? err.message : String(err),
          loc: { file: entryPath, start: 0, end: 0 },
        }],
        sourceTexts: new Map(),
      };
    }
  } else {
    try {
      buildPlatform = sourceTargetPlatform();
    } catch (err) {
      return {
        ok: false,
        diagnostics: [{
          code: "SC3002",
          message: err instanceof Error ? err.message : String(err),
          loc: { file: entryPath, start: 0, end: 0 },
        }],
        sourceTexts: new Map(),
      };
    }
    if (outputKind === "asm" || outputKind === "obj") {
      const refusal = nativeCodegenTargetRefusal();
      if (refusal !== null) {
        return {
          ok: false,
          diagnostics: [nativeCodegenDiag("SC3002", refusal, entryPath)],
          sourceTexts: new Map(),
        };
      }
      if (opts.sanitize === true) {
        return {
          ok: false,
          diagnostics: [nativeCodegenDiag(
            "SC3002",
            `--sanitize is not supported with --emit=${outputKind}; AddressSanitizer instrumentation parity is not available in the LLVM native helper yet`,
            entryPath,
          )],
          sourceTexts: new Map(),
        };
      }
    }
  }
  {
    const refusal = targetCpuTargetRefusal(opts.targetCpu, buildPlatform, nativeCodegenTarget()?.architecture ?? process.arch);
    if (refusal !== null) return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", refusal, entryPath)], sourceTexts: new Map() };
  }
  try {
    windowsSubsystemLinkerArgs(buildPlatform, opts.windowsSubsystem);
  } catch (err) {
    return {
      ok: false,
      diagnostics: [nativeCodegenDiag("SC3002", err instanceof Error ? err.message : String(err), entryPath)],
      sourceTexts: new Map(),
    };
  }
  const cacheRoot = outputKind === "exe" && provenanceSources() === null
    ? await prepareBuildCacheRoot(buildCacheRoot())
    : null;
  let earlyCacheOptions: EarlyExecutableCacheOptions | null = null;
  if (outputKind === "exe") {
    const helperObjectRoute = opts.nativeProgramObject === true ||
      (usesPrecompiledRuntimePack(opts, "llvm"));
    // Package content and native driver discovery are independent inputs to
    // the same cache key. Start both before waiting so edits do not pay their
    // filesystem and subprocess latency serially.
    const [implementation, nativeEnvironment] = await Promise.all([
      compilerImplementationIdentity(),
      helperObjectRoute
        ? executableLinkerEnvironmentFingerprint(
          process.env,
          nativeCodegenTarget()?.defaultLinker,
        )
        : executableNativeEnvironmentFingerprint(),
    ]);
    earlyCacheOptions = {
      entryPath,
      outDir: opts.outDir,
      outPath: opts.outPath,
      emitIr: opts.emitIr ?? false,
      sanitize: opts.sanitize ?? false,
      dynamic: opts.dynamic ?? false,
      backend: "llvm",
      ...(opts.optimization === "dev" ? { optimization: "dev" as const } : {}),
      ...(opts.strip ? { strip: true as const } : {}),
      ...(opts.windowsSubsystem === "gui" ? { windowsSubsystem: "gui" as const } : {}),
      ...(hostCacheIdentity(hostLinkOptions(opts)) === undefined
        ? {}
        : { host: hostCacheIdentity(hostLinkOptions(opts))! }),
      npmStatic: opts.npmStatic ?? null,
      ffiProfile:
        opts.ffiProfilePath === undefined || ffiProfileBytes === null
          ? null
          : { path: opts.ffiProfilePath, bytes: ffiProfileBytes },
      target: `${process.env["SCRIPTC_TARGET"] ?? "native"}:${buildPlatform}:${process.arch}:${
        opts.nativeProgramObject === true
          ? "helper-object"
          : helperObjectRoute ? "runtime-pack" : "driver-tu"
      }${opts.cpuDispatch === true ? ":cpu-dispatch" : ""}${opts.targetCpu === undefined || opts.targetCpu === "baseline" ? "" : `:cpu-${opts.targetCpu}`}${opts.nativeOutput === "android-main" ? ":android-main" : ""}`,
    compiler: [
        helperObjectRoute
          ? resolvePlatformLinker(process.env, nativeCodegenTarget()?.defaultLinker)
          : (process.env["SCRIPTC_CC"] ?? "clang"),
      ],
      nativeEnvironment,
      nodeVersion: process.version,
      implementation: implementation.digest,
      implementationDependencies: implementation.dependencies,
    };
  }
  const earlyHit = earlyCacheOptions === null
    ? null
    : await readEarlyExecutableCache(cacheRoot, earlyCacheOptions);
  if (earlyHit !== null) {
    timing("executable-cache-hit");
    if (earlyCacheOptions === null) {
      throw new InternalCompilerError("executable cache hit without executable cache options");
    }
    const executableCacheOptions = earlyCacheOptions;
    // Route/proof metadata is independently evictable. A full-compiler
    // fallback that still finds the validated payload repairs that lightweight
    // index so the next identical CLI invocation can avoid this module graph.
    await publishEarlyExecutableRoute(cacheRoot, executableCacheOptions).catch(() => undefined);
    if (earlyHit.executableRestored) {
      await pruneBuildCache(cacheRoot);
      timing("complete");
      return {
        ok: true,
        artifact: {
          kind: "exe",
          path: opts.outPath,
          translationUnitPath: earlyHit.llvmPath,
          backend: earlyHit.native.backend,
        },
        binaryPath: opts.outPath,
        llvmPath: earlyHit.llvmPath,
        backend: earlyHit.native.backend,
        ...(earlyHit.irPath === undefined ? {} : { irPath: earlyHit.irPath }),
      };
    }
    let nativeInputPath = earlyHit.llvmPath;
    let nativeProgramObject: NativeProgramObject | null = null;
    const useRuntimePack = opts.nativeProgramObject === true ||
      usesPrecompiledRuntimePack(opts, earlyHit.native.backend);
    if (useRuntimePack) {
      if (earlyHit.native.backend !== "llvm") {
        throw new InternalCompilerError(
          "native program-object cache hit restored a non-LLVM translation unit",
        );
      }
      try {
        nativeProgramObject = await emitNativeProgramObject(
          entryPath,
          opts,
          await readFile(earlyHit.llvmPath, "utf8"),
        );
        nativeInputPath = nativeProgramObject.linkPath;
      } catch (err) {
        if (!(err instanceof NativeCodegenError)) throw err;
        return {
          ok: false,
          diagnostics: [nativeCodegenDiag(err.diagnosticCode, err.message, entryPath)],
          sourceTexts: new Map(),
        };
      }
    }
    try {
      await compileExecutableNative(
        earlyHit.native,
        nativeInputPath,
        opts.outPath,
        opts.sanitize ?? false,
        ffi,
        opts.windowsSubsystem,
        opts.strip,
        null,
        nativeProgramObject?.dependencies,
        opts.nativeProgramObject === true ? undefined : async ({ dependencies }) => {
          await publishEarlyExecutableCache(cacheRoot, executableCacheOptions, {
            ...earlyHit,
            executableRestored: true,
            nativeDependencies: dependencies,
            frontend: earlyHit.frontend,
          });
        },
        nativeProgramObject?.partitionPaths,
        hostLinkOptions(opts),
        opts.nativeOutput === "android-main",
      );
      if (nativeProgramObject !== null && opts.nativeProgramObject === true) {
        await rename(nativeProgramObject.linkPath, nativeProgramObject.artifactPath);
      }
    } catch (err) {
      if (err instanceof RuntimePackError) {
        return { ok: false, diagnostics: [runtimePackDiagnostic(err, entryPath)], sourceTexts: new Map() };
      }
      if (ffi !== null && err instanceof CcCompileError) {
        return {
          ok: false,
          diagnostics: [ffiNativeBuildDiag(
            ffiNativeBuildDetail(err),
            opts.ffiProfilePath ?? entryPath,
          )],
          sourceTexts: new Map(),
        };
      }
      throw err;
    } finally {
      if (nativeProgramObject !== null) {
        await removeNativeProgramObject(nativeProgramObject.linkPath, nativeProgramObject.partitionPaths);
      }
    }
    await pruneBuildCache(cacheRoot);
    return {
      ok: true,
      artifact: {
        kind: "exe",
        path: opts.outPath,
        translationUnitPath: earlyHit.llvmPath,
        backend: earlyHit.native.backend,
      },
      binaryPath: opts.outPath,
      llvmPath: earlyHit.llvmPath,
      backend: earlyHit.native.backend,
      ...(earlyHit.irPath === undefined ? {} : { irPath: earlyHit.irPath }),
    };
  }
  timing("executable-cache-miss");
  const prepared = await prepareExecutableInput(entryPath, opts, ffi, buildPlatform, timing);
  if ("ok" in prepared) return prepared;
  const { llvmSource, llvmPath, irPath, nativeFeatures, programSplit, sourceTexts } = prepared;
  const backend = "llvm" as const;
  await mkdir(dirname(opts.outPath), { recursive: true });
  if (earlyCacheOptions === null) {
    throw new InternalCompilerError("executable emission without executable cache options");
  }
  const executableCacheOptions = earlyCacheOptions;
  let publishedExecutable = false;
  let nativeProgramObject: NativeProgramObject | null = null;
  try {
    const useRuntimePack = opts.nativeProgramObject === true ||
      usesPrecompiledRuntimePack(opts, backend);
    if (useRuntimePack) {
      if (backend !== "llvm" || llvmSource === null) {
        throw new InternalCompilerError("native program-object validation requires the LLVM backend");
      }
      try {
        nativeProgramObject = await emitNativeProgramObject(entryPath, opts, llvmSource);
        timing("native-object");
      } catch (err) {
        if (!(err instanceof NativeCodegenError)) throw err;
        return {
          ok: false,
          diagnostics: [nativeCodegenDiag(err.diagnosticCode, err.message, entryPath)],
          sourceTexts,
        };
      }
    }
    await compileExecutableNative(
      nativeFeatures,
      nativeProgramObject?.linkPath ?? llvmPath,
      opts.outPath,
      opts.sanitize ?? false,
      ffi,
      opts.windowsSubsystem,
      opts.strip,
      programSplit,
      nativeProgramObject?.dependencies,
      opts.nativeProgramObject === true ? undefined : async ({ dependencies }) => {
        await publishEarlyExecutableCache(cacheRoot, executableCacheOptions, {
          llvmPath,
          native: nativeFeatures,
          executableRestored: true,
          nativeDependencies: dependencies,
          frontend: frontendInputs.snapshot(),
          ...(irPath === undefined ? {} : { irPath }),
        });
        publishedExecutable = true;
      },
      nativeProgramObject?.partitionPaths,
      hostLinkOptions(opts),
      opts.nativeOutput === "android-main",
    );
    timing("native-link");
    if (nativeProgramObject !== null && opts.nativeProgramObject === true) {
      await rename(nativeProgramObject.linkPath, nativeProgramObject.artifactPath);
    }
  } catch (err) {
    if (err instanceof RuntimePackError) {
      return { ok: false, diagnostics: [runtimePackDiagnostic(err, entryPath)], sourceTexts };
    }
    if (ffi !== null && err instanceof CcCompileError) {
      return {
        ok: false,
        diagnostics: [
          ffiNativeBuildDiag(
            ffiNativeBuildDetail(err),
            opts.ffiProfilePath ?? entryPath,
          ),
        ],
        sourceTexts,
      };
    }
    throw err;
  } finally {
    if (nativeProgramObject !== null) {
      await removeNativeProgramObject(nativeProgramObject.linkPath, nativeProgramObject.partitionPaths);
    }
  }
  if (!publishedExecutable) {
    await publishEarlyExecutableCache(cacheRoot, executableCacheOptions, {
      llvmPath,
      native: nativeFeatures,
      executableRestored: false,
      frontend: frontendInputs.snapshot(),
      ...(irPath === undefined ? {} : { irPath }),
    }).catch(() => undefined);
  }
  await pruneBuildCache(cacheRoot);
  timing("complete");
  return {
    ok: true,
    artifact: {
      kind: "exe",
      path: opts.outPath,
      translationUnitPath: llvmPath,
      backend,
    },
    binaryPath: opts.outPath,
    llvmPath,
    backend,
    ...(irPath !== undefined ? { irPath } : {}),
  };
}

/* ── library emission mode ───────────────────────────────────────────────
 * `scriptc build --lib --profile <file>`: compile the profile's ONE entry module
 * to a linkable static archive (<name>.lib.a) exporting exactly the
 * profile-declared C-ABI symbols — no main, no event loop, no signal
 * handlers, traps to the host's registered sink. The profile pins the
 * emission; there is no fallback concept on this path (an out-of-tier
 * program under emission "llvm" is SC3001, fail-loudly). */

function libraryNativeFeatures(
  mod: IrModule,
  backend: "llvm",
): EarlyLibraryNativeFeatures {
  const features = moduleRuntimeFeatures(mod);
  return {
    backend,
    regex: features.regex,
    assert: features.assert,
    inspect: features.inspect,
    symbol: features.symbol,
    bigint: features.bigint,
    searchParams: features.searchParams,
    emitter: features.emitter,
    zlib: features.zlib,
    copying: features.copying,
    textDecoderLegacy: features.legacyTextDecoder,
    dynInvoke: features.dynInvoke,
    ...(features.recordSourceGet ? { recordSourceGet: true } : {}),
    ...(features.arrJoinStr ? { arrJoinStr: true } : {}),
    ...(features.dynBuffer ? { dynBuffer: true } : {}),
    ...(features.dynTier ? { dynTier: true } : {}),
    ...(features.mutableBuffers ? { mutableBuffers: true } : {}),
    ...(features.fnMemberProps ? { fnMemberProps: true } : {}),
    ...(mod.lib?.identity !== undefined ? { buildId: mod.lib.identity.buildId } : {}),
  };
}

async function compileLibraryNative(
  profile: LibraryProfile,
  llvmPath: string,
  archivePath: string,
  sanitize: boolean,
  features: EarlyLibraryNativeFeatures,
): Promise<void> {
  const wasmTarget = nativeCodegenTarget();
  if (wasmTarget?.platform === "wasi") {
    await compilePackedLibrary({
      cPath: llvmPath, outPath: archivePath, optimization: profile.optimization, ...features,
    }, wasmTarget, libraryWasmExports(profile));
    return;
  }
  const localizeSymbols = libraryLocalizeSymbols(profile);
  let identityLlvmSource: string | undefined;
  let programSource: string | undefined;
  if (
    profile.sidecar !== null ||
    (profile.emission === "llvm" && profile.optimization === "dev" && !sanitize)
  ) {
    const publicSource = await readFile(llvmPath, "utf8");
    programSource = publicSource;
  }
  if (profile.sidecar !== null) {
    if (features.buildId === undefined) throw new InternalCompilerError("library identity TU has no build id");
    const withoutIdentity = stripLibraryIdentity(programSource!);
    if (withoutIdentity === programSource) {
      throw new InternalCompilerError("generated public library TU has no identity region");
    }
    programSource = withoutIdentity;
    identityLlvmSource = emitLibraryIdentityLines({
      buildIdSymbol: profile.sidecar.buildIdSymbol,
      abiVersionSymbol: profile.sidecar.abiVersionSymbol,
      buildId: features.buildId,
      abiVersion: profile.sidecar.abiVersion,
    }, "").join("\n");
  }
  const llvmSplit =
    profile.emission === "llvm" && profile.optimization === "dev" && !sanitize && programSource !== undefined
      ? splitLlvmLibraryProgram(programSource)
      : null;
  const packTarget = !sanitize ? nativeCodegenTarget() : null;
  if (!sanitize && packTarget === null) throw new NativeCodegenError("SC3002", nativeCodegenTargetRefusal() ?? "unsupported library target");
  const archiveOptions: Parameters<typeof compileExternalCLibrary>[0] = {
    cPath: llvmPath,
    ...(programSource !== undefined ? { programSource } : {}),
    ...(identityLlvmSource !== undefined ? { identityLlvmSource } : {}),
    ...(llvmSplit !== null
      ? {
          programShards: llvmSplit.shards,
          programPublicSymbols: llvmSplit.publicSymbols,
        }
      : {}),
    outPath: archivePath,
    cacheIdentity: "scriptc-generated-library-v1",
    sanitize,
    optimization: profile.optimization,
    ...(localizeSymbols !== undefined ? { localizeSymbols } : {}),
    ...(profile.instancePerThread ? { threadInstances: true } : {}),
    regex: features.regex,
    assert: features.assert,
    inspect: features.inspect,
    symbol: features.symbol,
    bigint: features.bigint,
    searchParams: features.searchParams,
    emitter: features.emitter,
    zlib: features.zlib,
    copying: features.copying,
    textDecoderLegacy: features.textDecoderLegacy,
    dynInvoke: features.dynInvoke,
    ...(features.recordSourceGet ? { recordSourceGet: true } : {}),
    ...(features.arrJoinStr ? { arrJoinStr: true } : {}),
    ...(features.dynBuffer ? { dynBuffer: true } : {}),
    ...(features.dynTier ? { dynTier: true } : {}),
    ...(features.mutableBuffers ? { mutableBuffers: true } : {}),
    ...(features.fnMemberProps ? { fnMemberProps: true } : {}),
  };
  if (packTarget !== null) await compilePackedLibrary(archiveOptions, packTarget);
  else await compileExternalCLibrary(archiveOptions);
}

async function emitSemanticLibraryHit(
  hit: SemanticLibraryCacheHit,
  profile: LibraryProfile,
  opts: CompileLibraryOptions,
  archivePath: string,
  cacheRoot: string | null,
  cacheOptions: EarlyLibraryCacheOptions,
  timing: (phase: string, detail?: Record<string, unknown>) => void,
): Promise<CompileLibraryResult> {
  const mod = hit.mod;
  const rootDir = dirname(resolve(opts.profilePath));
  let sidecarJson = hit.sidecarJson;
  if (profile.sidecar !== null) {
    if (mod.lib?.identity === undefined || sidecarJson === null) {
      throw new InternalCompilerError("semantic library cache lost sidecar identity metadata");
    }
    const modules = canonicalModuleGraph(rootDir, hit.sourceTexts);
    const { buildId, sourceHash } = libraryIdentityHashes(
      compilerReleaseVersion(),
      profile.profileBytes,
      modules,
    );
    mod.lib.identity.buildId = buildId;
    hit.native.buildId = buildId;
    sidecarJson = updateSidecarIdentity(sidecarJson, buildId, sourceHash);
  }
  const validation = validateModule(mod);
  if (validation.length > 0) {
    return {
      ok: false,
      diagnostics: validation.map((violation) => iceDiag(violation.message, violation.loc)),
      sourceTexts: hit.sourceTexts,
    };
  }
  await mkdir(opts.outDir, { recursive: true });
  const stem = basename(profile.entry).replace(/\.(ts|mts|cts|js|mjs|cjs)$/, "");
  const llvmPath = join(opts.outDir, `${stem}.lib.ll`);
  let translationUnit = hit.translationUnit;
  if (profile.sidecar !== null) {
    translationUnit = replaceLibraryIdentity(translationUnit, mod.lib!.identity!);
  }
  await writeFile(llvmPath, translationUnit);
  timing("semantic-tu-restore", { output_bytes: Buffer.byteLength(translationUnit) });
  let irPath: string | undefined;
  if (opts.emitIr) {
    irPath = join(opts.outDir, `${stem}.lib.ir.json`);
    await writeFile(irPath, serializeModule(mod, true));
  }
  await compileLibraryNative(
    profile,
    llvmPath,
    archivePath,
    opts.sanitize ?? false,
    hit.native,
  );
  timing("native-archive");
  let sidecarPath: string | undefined;
  if (sidecarJson !== null) {
    sidecarPath = profile.sidecar!.path !== null
      ? resolve(dirname(archivePath), profile.sidecar!.path)
      : `${archivePath}.contract.json`;
    await writeFile(sidecarPath, sidecarJson);
  }
  await publishEarlyLibraryCache(cacheRoot, cacheOptions, {
    llvmPath,
    native: hit.native,
    frontend: hit.frontend,
    semantic: { mod, sources: hit.sourceTexts },
    ...(irPath !== undefined ? { irPath } : {}),
    ...(sidecarPath !== undefined ? { sidecarPath } : {}),
  }).catch(() => undefined);
  await pruneBuildCache(cacheRoot);
  timing("semantic-cache-publish");
  timing("complete");
  return {
    ok: true,
    archivePath,
    llvmPath,
    backend: profile.emission,
    ...(irPath !== undefined ? { irPath } : {}),
    ...(sidecarPath !== undefined ? { sidecarPath } : {}),
  };
}

export async function compileLibrary(opts: CompileLibraryOptions): Promise<CompileLibraryResult> {
  clearCompileSessionCaches();
  const frontendInputs = new FrontendInputTracker();
  try {
    return await frontendInputs.run(() => compileLibraryTracked(opts, frontendInputs));
  } catch (error) {
    if (error instanceof RuntimePackError) return { ok: false, diagnostics: [runtimePackDiagnostic(error, opts.profilePath)], sourceTexts: new Map() };
    if (error instanceof NativeCodegenError) return { ok: false, diagnostics: [nativeCodegenDiag(error.diagnosticCode, error.message, opts.profilePath)], sourceTexts: new Map() };
    throw error;
  }
}

async function compileLibraryTracked(
  opts: CompileLibraryOptions,
  frontendInputs: FrontendInputTracker,
): Promise<CompileLibraryResult> {
  const timingOn = process.env["SCRIPTC_TIMING"] === "1";
  const timingStart = performance.now();
  let timingLast = timingStart;
  const timing = (phase: string, detail: Record<string, unknown> = {}): void => {
    if (!timingOn) return;
    const now = performance.now();
    process.stderr.write(
      `scriptc timing ${JSON.stringify({
        phase,
        phase_ms: Math.round((now - timingLast) * 10) / 10,
        total_ms: Math.round((now - timingStart) * 10) / 10,
        rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        ...detail,
      })}\n`,
    );
    timingLast = now;
  };
  const loadedProfile = loadLibraryProfile(resolve(opts.profilePath));
  timing("profile-load");
  if (!loadedProfile.ok) {
    return { ok: false, diagnostics: loadedProfile.diagnostics, sourceTexts: new Map() };
  }
  const profile = loadedProfile.profile;
  const entryPath = profile.entry;
  const profileDir = dirname(resolve(opts.profilePath));
  for (let directory = dirname(entryPath); ; directory = dirname(directory)) {
    for (const name of ["tsconfig.json", "package.json"]) {
      // Project configuration and package-realm metadata can affect the
      // frontend even when TypeScript did not request their bytes through
      // its delegated filesystem callbacks (tsgo may read them server-side).
      frontendInputs.run(() => {
        const path = join(directory, name);
        trackedReadFile(path);
      });
    }
    if (directory === profileDir || dirname(directory) === directory) break;
  }
  // Mobile-target admission first — a pure env/host check, so a refused
  // pairing never reaches toolchain discovery. iOS targets (device and
  // simulator) build on darwin hosts only: the Apple SDK sysroot and the
  // Mach-O localization linker live there. Android builds from any host
  // with an NDK; a near-miss mobile spelling refuses with the supported
  // set named.
  {
    const mobileRefusal = mobileTargetRefusal(process.env["SCRIPTC_TARGET"] ?? "");
    if (mobileRefusal !== null) {
      return {
        ok: false,
        diagnostics: decorateLibraryRefusals(
          [{ code: "SC3002", message: mobileRefusal, loc: { file: entryPath, start: 0, end: 0 } }],
          profile,
        ),
        sourceTexts: new Map(),
      };
    }
  }

  const buildPlatform = buildTargetPlatform();
  const archivePath = opts.outPath ?? join(
    opts.outDir,
    `${basename(entryPath).replace(/\.(ts|mts|cts|js|mjs|cjs)$/, "")}${buildPlatform === "wasi" ? ".wasm" : ".lib.a"}`,
  );
  if (buildPlatform === "wasi") {
    const refusal = libraryWasmRefusal(profile, opts.sanitize ?? false);
    if (refusal !== null) return { ok: false, diagnostics: [refusal], sourceTexts: new Map() };
  }

  // Multi-instance library mode (abi.localize_runtime) localizes per
  // OBJECT FORMAT: ELF and COFF archives localize from any host (cross
  // ELF merges through the cross driver's own lld; COFF merges and
  // demotes in process — see native-toolchain.ts's localizeLibraryObjects), and Mach-O
  // localization runs the macOS host linker, so macos and ios targets
  // admit darwin hosts only (the mobile admission above already refused
  // an ios triple off darwin). Everything else refuses before frontend/
  // backend work, naming the pairing. WASI refuses localization above:
  // each WebAssembly.Instance already owns its runtime state.
  if (profile.localizeRuntime && buildPlatform !== "wasi") {
    const packTarget = nativeCodegenTarget();
    const driver = opts.sanitize ? resolveCc() : {
      target: packTarget?.llvmTriple ?? process.env["SCRIPTC_TARGET"] ?? null,
    };
    const platform = buildPlatform;
    const targetArch = driver.target?.split("-", 1)[0] ?? null;
    // Native Linux retains its host-binutils implementation. Cross ELF is
    // rebuilt in process and currently accepts the two verified ELF64,
    // little-endian architectures; COFF is rebuilt in process and accepts
    // AMD64 only. Keep this preflight in lockstep with object-localize.ts so
    // unsupported object classes refuse before frontend/backend work.
    const supported =
      (platform === "linux" &&
        (driver.target === null || targetArch === "x86_64" || targetArch === "aarch64")) ||
      (platform === "win32" &&
        (driver.target === null ? process.arch === "x64" : targetArch === "x86_64")) ||
      (platform === "darwin" && process.platform === "darwin");
    if (!supported) {
      const subject =
        platform === "win32"
          ? "runtime-localized (multi-instance) library archives (COFF localization currently requires x86_64)"
          : platform === "linux" && driver.target !== null
            ? "runtime-localized (multi-instance) library archives (cross-ELF localization currently requires x86_64 or aarch64)"
            : platform === "darwin"
              ? `runtime-localized (multi-instance) library archives on ${process.platform} hosts (Mach-O localization runs the macOS host linker)`
              : "runtime-localized (multi-instance) library archives";
      return {
        ok: false,
        diagnostics: decorateLibraryRefusals([
          targetRefusalDiag(
            process.env["SCRIPTC_TARGET"] || driver.target || platform,
            subject,
            { file: entryPath, start: 0, end: 0 },
          ),
        ], profile),
        sourceTexts: new Map(),
      };
    }
  }

  const cacheRoot = provenanceSources() === null
    ? await prepareBuildCacheRoot(buildCacheRoot())
    : null;
  const earlyCacheOptions: EarlyLibraryCacheOptions = {
    profilePath: opts.profilePath,
    profileBytes: profile.profileBytes,
    entryPath,
    outDir: opts.outDir,
    ...(opts.outPath !== undefined ? { outPath: opts.outPath } : {}),
    emitIr: opts.emitIr ?? false,
    sanitize: opts.sanitize ?? false,
    target: `${process.env["SCRIPTC_TARGET"] ?? "native"}:${buildPlatform}:${process.arch}`,
    compiler: [process.env["SCRIPTC_CC"] ?? "clang"],
    nodeVersion: process.version,
    implementation: await libraryFrontendImplementationFingerprint(),
  };
  const earlyHit = await readEarlyLibraryCache(
    cacheRoot,
    earlyCacheOptions,
    profile.sidecar === null ? undefined : profile.sidecar.path,
  );
  if (earlyHit !== null) {
    timing("early-cache-hit");
    await compileLibraryNative(
      profile,
      earlyHit.llvmPath,
      archivePath,
      opts.sanitize ?? false,
      earlyHit.native,
    );
    timing("native-archive");
    timing("complete");
    return {
      ok: true,
      archivePath,
      llvmPath: earlyHit.llvmPath,
      backend: earlyHit.native.backend,
      ...(earlyHit.irPath !== undefined ? { irPath: earlyHit.irPath } : {}),
      ...(earlyHit.sidecarPath !== undefined ? { sidecarPath: earlyHit.sidecarPath } : {}),
    };
  }
  timing("early-cache-miss");
  const semanticHit = await readSemanticLibraryCache(
    cacheRoot,
    earlyCacheOptions,
    profile.sidecar === null ? undefined : profile.sidecar.path,
  );
  if (semanticHit !== null) {
    timing("semantic-cache-hit", { changed_sources: semanticHit.changedSources.length });
    return emitSemanticLibraryHit(
      semanticHit,
      profile,
      opts,
      archivePath,
      cacheRoot,
      earlyCacheOptions,
      timing,
    );
  }
  timing("semantic-cache-miss");

  const prepared = prepareLibrary(profile, opts.profilePath, compilerReleaseVersion(), buildPlatform, nodeFrontend, timing);
  if (!prepared.ok) return prepared;
  const { mod, sourceTexts, sidecarJson } = prepared;
  const fail = (diagnostics: ScrDiagnostic[]): CompileLibraryResult => ({
    ok: false, diagnostics: decorateLibraryRefusals(diagnostics, profile), sourceTexts,
  });

  await mkdir(opts.outDir, { recursive: true });
  const stem = basename(entryPath).replace(/\.(ts|mts|cts|js|mjs|cjs)$/, "");
  const llvmPath = join(opts.outDir, `${stem}.lib.ll`);
  try {
    const ll = emitLlvmModuleSource(mod, {
      targetTriple: process.env["SCRIPTC_TARGET"] ?? "",
      pointerBits: buildPlatform === "wasi" ? 32 : 64,
      wasi: buildPlatform === "wasi",
    });
    timing("llvm-emit", { output_bytes: typeof ll === "string" ? Buffer.byteLength(ll) : ll.reduce((bytes, part) => bytes + Buffer.byteLength(part), 0) });
    await writeFile(llvmPath, ll);
    timing("llvm-write");
  } catch (err) {
    if (!(err instanceof LlvmUnsupportedError)) throw err;
    return fail([llvmRefusalDiag(err, entryPath)]);
  }

  let irPath: string | undefined;
  if (opts.emitIr) {
    irPath = join(opts.outDir, `${stem}.lib.ir.json`);
    await writeFile(irPath, serializeModule(mod, true));
  }

  const nativeFeatures = libraryNativeFeatures(mod, profile.emission);
  await compileLibraryNative(
    profile,
    llvmPath,
    archivePath,
    opts.sanitize ?? false,
    nativeFeatures,
  );
  timing("native-archive");

  // The sidecar lands beside the compiled object, written by the same
  // invocation (profile-declared name; the neutral default when the
  // profile states none is <out>.contract.json).
  let sidecarPath: string | undefined;
  if (sidecarJson !== null) {
    sidecarPath =
      profile.sidecar!.path !== null
        ? resolve(dirname(archivePath), profile.sidecar!.path)
        : `${archivePath}.contract.json`;
    await writeFile(sidecarPath, sidecarJson);
  }
  const earlyPublish: EarlyLibraryCachePublish = {
    llvmPath,
    native: nativeFeatures,
    frontend: frontendInputs.snapshot(),
    semantic: { mod, sources: sourceTexts },
    ...(irPath !== undefined ? { irPath } : {}),
    ...(sidecarPath !== undefined ? { sidecarPath } : {}),
  };
  await publishEarlyLibraryCache(cacheRoot, earlyCacheOptions, earlyPublish).catch(() => undefined);
  await pruneBuildCache(cacheRoot);
  timing("early-cache-publish");
  timing("complete");
  return {
    ok: true,
    archivePath,
    llvmPath,
    backend: profile.emission,
    ...(irPath !== undefined ? { irPath } : {}),
    ...(sidecarPath !== undefined ? { sidecarPath } : {}),
  };
}

/** A lowered program as a WasmGC build: the release policy (no reachable unsupported-operation fence, no dev
 * optimization), the emit with the options the compile request resolves to, and the artifacts beside the binary (source
 * map, host imports and modules, fence receipt, link and specialization manifests, release manifest). Whole-program
 * builds and object links (link/build.ts emitLinkedWasmGc) share it, so both refuse and receipt alike. */
/** The WasmGC output under its capability modes (docs/capabilities.md §4): the preferred artifact, then at most one
 * compat variant when a declared target needs one and the program uses the feature that differs. */
async function emitWasmGcArtifacts(mod: IrModule, opts: CompileRequestOptions, entryPath: string, sourceTexts: Map<string, string>,
  profileSites: SiteProfileIndex | undefined): Promise<CompileRequestResult> {
  const parsedCaps = typeof opts.capabilities === "object" ? { request: opts.capabilities, errors: [] as string[] } : parseCapabilities(opts.capabilities);
  const parsedTargets = parseTargets(opts.targets ?? DEFAULT_TARGETS);
  const optionErrors = [...parsedCaps.errors, ...parsedTargets.errors];
  if (optionErrors.length) return { ok: false, diagnostics: optionErrors.map(m => nativeCodegenDiag("SC3002", m, entryPath)), sourceTexts };
  // Without capabilities or targets the compiler builds the baseline only (no variant set); the npm package asks for auto.
  const explicitCaps = opts.capabilities !== undefined || opts.targets !== undefined;
  const request: CapabilityRequest = { ...parsedCaps.request, ...(explicitCaps ? {} : { preset: "baseline" as const }), ...(parsedCaps.request.relaxedSimd === undefined && opts.experimentalRelaxedSimd === true ? { relaxedSimd: true } : {}) };
  const preferred = preferredMode(request);
  const first = await emitWasmGcArtifact(mod, opts, entryPath, sourceTexts, profileSites, fences0(mod), preferred, "preferred");
  if (!first.ok || first.artifact.kind !== "wasmgc") return first;
  const uses = first.artifact.capabilityUses!;
  const plan = planVariants(request, preferred, uses, parsedTargets.targets);
  if (plan.errors.length) return { ok: false, diagnostics: plan.errors.map(m => nativeCodegenDiag("SC3002", m, entryPath)), sourceTexts };
  const variantsPath = `${opts.outPath}.variants.json`;
  const compatPath = opts.outPath.replace(/(\.wasm)?$/, ".compat.wasm");
  const variants: { path: string; key: string; requires: Requirement[] }[] = [{ path: opts.outPath, key: first.artifact.capabilities!.key, requires: first.artifact.capabilities!.requires }];
  if (plan.compat) {
    const second = await emitWasmGcArtifact(mod, { ...opts, outPath: compatPath }, entryPath, sourceTexts, profileSites, fences0(mod), plan.compat, "compat");
    if (!second.ok || second.artifact.kind !== "wasmgc") return second;
    variants.push({ path: compatPath, key: second.artifact.capabilities!.key, requires: second.artifact.capabilities!.requires });
    const set: VariantSet = { schema: VARIANTS_SCHEMA, variants: variants.map(v => ({ file: basename(v.path), key: v.key, requires: v.requires })) };
    await writeFile(variantsPath, JSON.stringify(set, null, 2) + "\n");
  } else await rm(variantsPath, { force: true });
  return { ...first, artifact: { ...first.artifact, variants, explainCapabilities: plan.explain } };
}

/** The fences of a module (the release gate's list). */
const fences0 = (mod: IrModule) => collectFences(mod);

async function emitWasmGcArtifact(mod: IrModule, opts: CompileRequestOptions, entryPath: string, sourceTexts: Map<string, string>,
  profileSites: SiteProfileIndex | undefined, collected: ReturnType<typeof collectFences>, capabilityMode: CapabilityMode, capabilityVariant: "preferred" | "compat"): Promise<CompileRequestResult> {
  // One list for the release gate and the fence receipt (the emitter copies before it changes the IR), so a fence
  // refuses a release exactly when the receipt reports it.
  const fences = collected;
  if (opts.release) {
    // A release build: optimized, and no reachable unsupported-operation fence.
    if (opts.optimization === "dev") return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "a release build cannot use optimization \"dev\"", entryPath)], sourceTexts };
    if (fences.length > 0) {
      return { ok: false, sourceTexts, diagnostics: fences.map((f) => ({ ...nativeCodegenDiag("SC3002",
        `release build: this operation is not supported by the compiler yet and would fail at run time (${f.code}: ${f.message})`, entryPath), loc: f.loc })) };
    }
  }
  {
    let emitted: WasmGcEmitResult;
    const wantSourceMap = opts.sourceMap === true || process.env["SCRIPTC_WASMGC_SOURCE_MAP"] === "1";
    // The text the compiler read for a file, else what is on disk now.
    const sourceText = (file: string): string | undefined => {
      const known = sourceTexts.get(file);
      if (known !== undefined) return known;
      try { return readFileSync(file, "utf8"); } catch { return undefined; }
    };
    try {
      emitted = emitWasmGcModule(mod, { jsFences: !opts.release, ...(wantSourceMap ? { sourceMap: { sourceText, url: opts.sourceMapUrl ?? process.env["SCRIPTC_WASMGC_SOURCE_MAP_URL"] ?? `${basename(opts.outPath)}.map`, sourcesContent: opts.sourceMapContent === true || process.env["SCRIPTC_WASMGC_SOURCE_MAP_CONTENT"] === "1" } } : {}), fuseTestCasts: opts.fuseTestCasts === true, noPageFacades: opts.noPageFacades === true, ...(opts.inModuleMath === false ? { inModuleMath: false } : {}), experimentalTsNativeAny: opts.experimentalTsNativeAny === true, experimentalOpaquePageExpandos: opts.experimentalOpaquePageExpandos === true, experimentalRelaxedSimd: capabilityMode.relaxedSimd, capabilityMode, capabilityVariant, experimentalDynI31: opts.experimentalDynI31 === true, experimentalDomMirror: opts.experimentalDomMirror === true, hostHandles: opts.hostHandles === true, stripSourceSites: opts.stripSourceSites === true, ...(dynInlineSlots(opts) ? { experimentalDynInlineSlots: dynInlineSlots(opts) } : {}), experimentalJsConstructorStructs: opts.experimentalJsConstructorStructs === true, experimentalJsLiteralStructs: opts.experimentalJsLiteralStructs === true, experimentalJsPointsTo: opts.experimentalJsPointsTo === true, optimizeLevel: opts.optimization === "dev" ? 0 : 2, engineDyn: opts.browser === true && opts.dynModel !== "native", browser: opts.browser === true, ...(opts.experimentalJsSpecialize === "guarded" ? { experimentalJsSpecialize: opts.experimentalJsSpecialize, experimentalJsSpecializeProperties: opts.experimentalJsSpecializeProperties, experimentalJsSpecializeCounters: opts.experimentalJsSpecializeCounters } : {}), ...(profileSites ? { profileSites, profileMinInvocations: Number(process.env["SCRIPTC_PGO_MIN_INVOCATIONS"] ?? 0) || 0, profileCounters: opts.experimentalJsSpecializeCounters === true } : {}), ...((opts as { wasmLink?: WasmGcLink }).wasmLink ? { link: (opts as { wasmLink?: WasmGcLink }).wasmLink } : {}) });
    } catch (err) {
      if (!(err instanceof WasmGcUnsupportedError)) throw err;
      return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", err.message, entryPath)], sourceTexts };
    }
    if (opts.wasmTransforms?.length) emitted = await applyWasmTransforms(emitted, opts.wasmTransforms, { entryPath, outPath: opts.outPath, release: opts.release === true, ...(emitted.pendingFinish ? { pendingFinish: emitted.pendingFinish } : {}) });
    const writeStart = performance.now();
    await mkdir(dirname(opts.outPath), { recursive: true });
    await writeFile(opts.outPath, emitted.binary);
    if (emitted.sourceMap !== undefined) await writeFile(`${opts.outPath}.map`, emitted.sourceMap);
    else await rm(`${opts.outPath}.map`, { force: true });
    await writeFile(`${opts.outPath}.host.json`, JSON.stringify(emitted.hostImports, null, 2) + "\n");
    // The resolved capabilities (the module's scriptc.capabilities section, as a file for tools that do not read wasm).
    if (emitted.capabilities) await writeFile(`${opts.outPath}.capabilities.json`, JSON.stringify(emitted.capabilities, null, 2) + "\n");
    if (emitted.hostModules) await writeFile(`${opts.outPath}.host-modules.json`, JSON.stringify(emitted.hostModules, null, 2) + "\n");
    else await rm(`${opts.outPath}.host-modules.json`, { force: true });
    // The fence receipt: every JavaScript construct this build compiled as a
    // runtime error instead of code (the frontend's deferred statement
    // fences and the backend's jsFences), so nothing is dropped silently.
    const frontendFences = fences, backendFences = emitted.fences ?? [];
    if (frontendFences.length || backendFences.length) await writeFile(`${opts.outPath}.fences.json`, JSON.stringify({ schema: "scriptc-wasmgc-fences/1",
      note: "JavaScript constructs compiled as runtime errors (each throws when its code runs); a release build refuses them",
      backend: backendFences, frontend: frontendFences }, null, 2) + "\n");
    else await rm(`${opts.outPath}.fences.json`, { force: true });
    // Discrete library compilation: a shared-runtime module's link manifest
    // (its compile-time atoms, which a client's continue).
    const sharedLink = (opts as { wasmLink?: WasmGcLink }).wasmLink;
    if (sharedLink?.sharedRuntime) await writeFile(`${opts.outPath}.link.json`, JSON.stringify({ schema: "scriptc-wasmgc-link/1", namespace: sharedLink.namespace, role: sharedLink.sharedRuntime.role, atoms: emitted.atoms ?? [] }) + "\n");
    else await rm(`${opts.outPath}.link.json`, { force: true });
    if (opts.experimentalJsSpecialize === "guarded") await writeFile(`${opts.outPath}.specialization.json`, JSON.stringify({ schema: "scriptc-js-specialization/1", mode: opts.experimentalJsSpecialize, properties: opts.experimentalJsSpecializeProperties ?? null, counters: emitted.specializationCounters, sites: emitted.specializations }, null, 2) + "\n");
    else if (profileSites) await writeFile(`${opts.outPath}.specialization.json`, JSON.stringify({ schema: "scriptc-js-specialization/1", mode: "profile", counters: opts.experimentalJsSpecializeCounters === true,
      profile: { path: profileSites.path, sha256: profileSites.sha256, kept: profileSites.kept, survived: profileSites.survived, dropped: profileSites.dropped, otherEntry: profileSites.otherEntry, unkeyed: profileSites.unkeyed, ...(profileSites.coverage ? { coverage: profileSites.coverage } : {}), files: profileSites.files },
      totals: emitted.profileReport?.totals ?? {}, sites: emitted.profileReport?.sites ?? [],
      // Lifted functions have no source name: their spans key CPU-profile frames back to source (and to profile sites' fn).
      functions: Object.fromEntries(mod.functions.filter(f => f.name.startsWith("%") && f.loc?.file).map(f => [f.name, f.loc])) }, null, 2) + "\n");
    else await rm(`${opts.outPath}.specialization.json`, { force: true });
    if (opts.release) await writeFile(`${opts.outPath}.manifest.json`, JSON.stringify(wasmGcManifest(mod, emitted, opts), null, 2) + "\n");
    return { ok: true, artifact: { kind: "wasmgc", path: opts.outPath, asyncLiveness: emitted.asyncLiveness,
      ...(emitted.capabilities ? { capabilities: emitted.capabilities } : {}), ...(emitted.capabilityUses ? { capabilityUses: emitted.capabilityUses } : {}), ...(emitted.optimizer ? { optimizer: emitted.optimizer } : {}),
      ...(emitted.phases ? { emitPhases: emitted.phases } : {}), ...(emitted.helpers ? { emitHelpers: emitted.helpers } : {}), ...(emitted.pendingFinish ? { pendingFinish: emitted.pendingFinish } : {}), writeMs: Math.round(performance.now() - writeStart) } };
  }
}

/** CompileBaseOptions.wasmTransforms over an emitted module, in order. Each sees the parts the previous one left. */
async function applyWasmTransforms(emitted: WasmGcEmitResult, transforms: readonly WasmGcTransform[], context: WasmGcTransformContext): Promise<WasmGcEmitResult> {
  let out = emitted;
  for (const transform of transforms) {
    const parts: WasmGcArtifactParts = { binary: out.binary, hostImports: out.hostImports, ...(out.hostModules ? { hostModules: out.hostModules } : {}), ...(out.sourceMap !== undefined ? { sourceMap: out.sourceMap } : {}) };
    const changed = await transform(parts, context);
    if (!changed) continue;
    if (changed.binary !== undefined && !(changed.binary instanceof Uint8Array)) throw new TypeError("a wasmTransforms entry returned a binary that is not a Uint8Array");
    out = { ...out, ...changed };
  }
  return out;
}

/** emitWasmGcArtifacts for an object link's joined program: the build options are the compile options its objects
 * were lowered with, plus outPath (and release). */
export async function emitLinkedWasmGc(mod: IrModule, opts: CompileRequestOptions): Promise<CompileRequestResult> {
  if (opts.experimentalJsSpecialize !== undefined)
    return { ok: false, diagnostics: [nativeCodegenDiag("SC3002", "specialization profiles are not supported for object links yet", mod.sourceFile)], sourceTexts: new Map() };
  return emitWasmGcArtifacts(mod, { ...opts, outputKind: "wasmgc" }, mod.sourceFile, new Map(), undefined);
}

/** The release capability manifest: what the artifact requires and promises. */
/** experimentalDynInlineSlots default for browser native WasmGC (unobservable;
 * GC_DISCOVERY.md, wave 9 w9-gc-floor): one allocation for objects of up to five
 * properties. A shared runtime keeps 0 (dyn:obj's layout is its ABI). */
export const DEFAULT_DYN_INLINE_SLOTS = 5;
/** The inline-slot count a compile uses: the option when given (0 turns it off), else the default. */
function dynInlineSlots(opts: CompileRequestOptions): number {
  if (opts.experimentalDynInlineSlots !== undefined) return opts.experimentalDynInlineSlots;
  // Profile-guided builds only: their sites read constant slots (a struct.get per inline field). Without
  // a profile an inline-cached read's slot is a run-time index, which an inline field can only answer
  // through a br_table (bench/loops: find, some and their JS twins 10–25% more instructions per element).
  return opts.browser && opts.dynModel === "native" && opts.experimentalJsSpecialize === "profile"
    && !(opts as { wasmLink?: WasmGcLink }).wasmLink?.sharedRuntime ? DEFAULT_DYN_INLINE_SLOTS : 0;
}
function wasmGcManifest(mod: IrModule, emitted: WasmGcEmitResult, opts: CompileRequestOptions): unknown {
  const imports = emitted.hostImports;
  const pageGlobals = new Set<string>();
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    const node = n as { kind?: string; op?: string; name?: string };
    if (node.kind === "jsOp" && node.op === "globalGet" && node.name) pageGlobals.add(node.name);
    for (const v of Object.values(n)) if (v && typeof v === "object") visit(v);
  };
  for (const f of mod.functions) visit(f.body);
  const link = (opts as { wasmLink?: WasmGcLink }).wasmLink;
  return {
    manifest: "scriptc-wasmgc-release/1",
    compiler: { name: "scriptc", version: VERSION },
    hostAbi: WASMGC_HOST_ABI,
    linkAbi: link ? "scriptc-wasmgc-link/1 (scalars by value; byte arrays as borrowed (pointer, length-in-elements); retained-bytes spans pinned; shared-bytes returns read in place as non-owning views)" : null,
    dynModel: opts.browser ? (opts.dynModel === "native" ? "native" : "engine") : null,
    experimentalJsSpecialize: opts.experimentalJsSpecialize ?? null,
    ...(opts.experimentalJsSpecialize === "profile" ? { experimentalJsSpecializeProfile: opts.experimentalJsSpecializeProfile, ...(opts.experimentalJsSpecializeCoverage !== undefined ? { experimentalJsSpecializeCoverage: opts.experimentalJsSpecializeCoverage } : {}) } : {}),
    experimentalTsNativeAny: opts.experimentalTsNativeAny ?? false,
    experimentalOpaquePageExpandos: opts.experimentalOpaquePageExpandos ?? false,
    ...(opts.experimentalJsConstructorStructs ? { experimentalJsConstructorStructs: true } : {}),
    ...(opts.experimentalJsLiteralStructs ? { experimentalJsLiteralStructs: true } : {}),
    ...(opts.experimentalJsPointsTo ? { experimentalJsPointsTo: true } : {}),
    ...(opts.experimentalRelaxedSimd ? { experimentalRelaxedSimd: true } : {}),
    ...(opts.experimentalDynI31 ? { experimentalDynI31: true } : {}),
    ...(opts.experimentalDomMirror ? { experimentalDomMirror: true } : {}),
    ...(dynInlineSlots(opts) ? { experimentalDynInlineSlots: dynInlineSlots(opts) } : {}),
    ...(emitted.functionEffects ? { functionEffects: emitted.functionEffects, pureCallElisions: emitted.pureCallElisions } : {}),
    asyncLiveness: emitted.asyncLiveness,
    ...(emitted.optimizer ? { optimizer: emitted.optimizer } : {}),
    experimentalJsSpecializeProperties: opts.experimentalJsSpecializeProperties ?? null,
    experimentalJsSpecializeCounters: opts.experimentalJsSpecializeCounters ?? false,
    browserCapabilities: [
      "WebAssembly GC", "exception handling (exnref, JSTag)", "JS String Builtins (wasm:js-string)", "imported string constants",
      // A shared memory never detaches, so it replaces the resizable-buffer requirement.
      ...(link?.memory?.shared
        ? ["cross-origin isolation (COOP same-origin + COEP require-corp)", "SharedArrayBuffer", "shared WebAssembly.Memory", "threads (wasm atomics)"]
        : imports.includes("bytes.toJs") ? ["WebAssembly.Memory.prototype.toResizableBuffer (retained byte views)"] : []),
      ...((mod.ffiImports ?? []).some(f => f.suspending) ? ["JSPI (WebAssembly.Suspending / WebAssembly.promising)"] : []),
      ...(opts.experimentalRelaxedSimd ? ["Relaxed SIMD (experimentalRelaxedSimd: Chrome 114+, Firefox 145+; not Safari)"] : []),
    ],
    hostImports: imports,
    pageGlobals: [...pageGlobals].sort(),
    exports: link?.exports ?? ["main"],
    profile: {
      acceptedDivergences: ["r2-bytes-buffer-observation", "r2-foreign-array-identity", "r2-wrong-kind-own-view"],
      declaredRefusals: opts.dynModel === "native" ? ["Reflect.preventExtensions / Object.freeze / Object.seal on compiled objects"] : [],
    },
    trust: "trusted application integration: the host bridge gives the module ambient access to the page (globalThis lookup, DOM objects). Not an extension sandbox.",
  };
}
