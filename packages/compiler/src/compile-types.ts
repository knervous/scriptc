// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import type { WindowsSubsystem } from "./backend/targets.js";
import type { NativeLinkInfo } from "./backend/native-link-info.js";
import type { ScrDiagnostic } from "./diagnostics/diagnostic.js";
import type { CoverageInput } from "./coverage/report.js";
import type { WasmOptReceipt } from "./backend/wasmgc/emitter.js";
import type { IrModule } from "./ir/ir.js";
import type { ObjectUnit } from "./link/module-tag.js";

export type CompileOutputKind = "ir" | "wasmgc" | "llvm" | "asm" | "obj" | "exe";

/** A WasmGC module as emitted, before any of it is written: the binary and the sidecars the page's runtime reads. */
export interface WasmGcArtifactParts {
  /** The module's bytes (`<out>`). */
  binary: Uint8Array;
  /** The host imports the module names (`<out>.host.json`). */
  hostImports: string[];
  /** Typed host-module imports (`<out>.host-modules.json`), when the module has any. */
  hostModules?: { module: string; name: string; params: string[]; result: string }[];
  /** The source map JSON (`<out>.map`), when one was asked for. */
  sourceMap?: string;
}

/** What a WasmGC transform is told about the build it runs in. */
export interface WasmGcTransformContext {
  /** The entry file compiled. */
  entryPath: string;
  /** Where the module will be written. */
  outPath: string;
  /** A release build (CompileBaseOptions.release). */
  release: boolean;
  /** Finish passes still to run on the written module (the artifact's pendingFinish), if any. */
  pendingFinish?: readonly string[];
}

/** A transform of a WasmGC module between emission and the write (CompileBaseOptions.wasmTransforms): it returns the
 * parts it replaces (any field left out keeps its value), or nothing to keep them all. */
export type WasmGcTransform = (parts: Readonly<WasmGcArtifactParts>, context: WasmGcTransformContext) =>
  Partial<WasmGcArtifactParts> | void | Promise<Partial<WasmGcArtifactParts> | void>;

export interface CompileBaseOptions {
  /** Primary artifact path. The CLI supplies the output-kind default. */
  outPath: string;
  /** Where generated intermediates and compatibility side artifacts land. */
  outDir: string;
  /** @deprecated This option no longer controls output cleanup; sibling artifacts are retained. */
  defaultOutputPath?: boolean;
  /** Compatibility-only additive IR side artifact for executable builds.
   * The CLI's deprecated --emit-ir flag supplies this option. */
  emitIr?: boolean;
  sanitize?: boolean;
  /** Embed the dynamic-island engine (--dynamic). Off = the static default:
   * island constructs are diagnostics and nothing about codegen or linking
   * changes. */
  dynamic?: boolean;
  /** Browser target (WasmGC): lib.dom joins the program and DOM values are
   * island handles over the page's engine. Implies dynamic. */
  browser?: boolean;
  /** Native executables that reach an embedding host (the browser target's page operations, typed `host:` modules):
   * which host answers the host island's scr_host_ops() vtable (backend/host-island.ts), from the target's host pack
   * (`@scriptw/host-<platform>`, or SCRIPTW_HOST_PACK). "auto", the default: the pack's smallest set holding the host
   * services the program reaches (backend/host-features.ts; every service when it reads globals by a name the
   * compiler cannot see). A set's name ("full", "ui", "headless", "offline", or one the pack adds; "generic" is
   * "full"): that set. "quickjs": no host island; the engine island links as before. */
  host?: "auto" | "full" | "generic" | "ui" | "headless" | "offline" | "quickjs" | (string & {});
  /** With `host: "auto"`: host services to add ("audio") or remove ("-rtc") on top of what the program reaches
   * (window, gpu, audio, net, rtc; SCRIPTC_HOST_FEATURES). A removed service is absent for the program. */
  hostFeatures?: readonly string[];
  /** Print the chosen host set and why on stderr (SCRIPTC_EXPLAIN_HOST=1). */
  explainHost?: boolean;
  /** An embedder's static archive defining scr_host_ops(), linked in place of the host pack's (SCRIPTC_HOST_LIB). */
  hostLib?: string;
  /** Link arguments that follow `hostLib` (frameworks, system libraries; SCRIPTC_HOST_LINK_ARGS). */
  hostLinkArgs?: readonly string[];
  /** What the executable lane links. "executable", the default. "android-main" (SCRIPTC_TARGET=aarch64-linux-android
   * only): one shared library, `libmain.so`, whose exported `main` an Android Activity calls (backend/android-main.ts). */
  nativeOutput?: "executable" | "android-main";
  /** Browser target: specifiers (or prefixes) the page keeps as JavaScript and
   * supplies through instantiateWasmGc({ modules }), e.g. ["@app/engine"]. */
  hostModules?: readonly string[];
  /** Typed host modules (HOST_IMPORT_ABI section 7): the specifier schemes whose ambient `declare module "<scheme>:<name>"`
   * declarations compile as typed wasm imports, without the colon (`["host"]` admits `host:fetch`). Unset, the default:
   * every scheme except `node:`. A specifier of another scheme stays on the untyped page-module path (island.import). */
  hostModuleSchemes?: readonly string[];
  /** WasmGC output: transforms applied, in order, to the emitted module and its sidecars before anything is written
   * (WasmGcTransform). A build's own post-processing (renaming, string or section rewriting, a custom optimizer) plugs in
   * here. None by default: the output is exactly what the emitter produced. The receipts and the release manifest
   * describe the emitted module; a transform that changes what they report owns keeping them true. */
  wasmTransforms?: readonly WasmGcTransform[];
  /** Test runners: the other entries compiled in this batch. With the shared
   * tsgo host, one program serves them all (see browser-target.ts). */
  batchRoots?: readonly string[];
  /** Browser target: where untyped JS values live. "engine" (default): JS
   * engine values behind host calls. "native": compiled wasm values in the
   * same runtime (docs/WASMGC_NATIVE_OBJECT_MODEL.md). */
  dynModel?: "engine" | "native";
  /** Experimental native WasmGC profiles: guarded read paths, narrow
   * closed-module admission, or guards from a V8 site profile ("profile",
   * with experimentalJsSpecializeProfile). None invents types for arbitrary
   * JS: every guard falls back to the unchanged generic path. */
  experimentalJsSpecialize?: "guarded" | "closed" | "profile";
  /** "profile" mode: path of a scriptc-pgo-site-profile/1 JSON file (see
   * tests/wasmgc-react/pgo). Sites in files whose sha256 changed are dropped. */
  experimentalJsSpecializeProfile?: string;
  /** "profile" mode with a counted profile (one recorded with its guard counts):
   * guard only the hottest sites that together take this fraction (0 < c <= 1)
   * of the counted guard hits, of each counted operation kind's when the
   * profile has per-operation counts; the rest keep the generic path. */
  experimentalJsSpecializeCoverage?: number;
  /** Bundler-style constant definitions, as esbuild's and Vite's `define`:
   * each key a free dotted name (`process.env.NODE_ENV`, `__DEV__`), each
   * value the JSON text of a string, number, boolean or null
   * (`'"production"'`). A read of the name whose root is not a program
   * binding compiles as that literal, so libraries' NODE_ENV branches fold
   * as their bundled form does. Off by default (the oracle is Node, where
   * `process.env.NODE_ENV` is whatever the environment holds). */
  define?: Readonly<Record<string, string>>;
  /** Extra package resolution conditions, as Vite's `resolve.conditions`
   * and TypeScript's `customConditions`: matched (in the package.json's key
   * order, like the defaults) by project `imports`/`exports` maps, so a
   * package can name the module a compiled build takes (`"wasmgc"`) beside
   * the one every other build takes (`"default"`). The checker resolves with
   * the same conditions. */
  conditions?: readonly string[];
  /** Experimental browser/native lane: TS any uses checked Wasm values,
   * retaining foreign host references. This does not infer static types. */
  experimentalTsNativeAny?: boolean;
  /** Structural types accept classes: a record type a program class flows
   * into (a Vector3 into `{ x; y; z }`) holds either a record or the class,
   * by reference, dispatching members per arm (interface-class-arms.ts).
   * Default: on for WasmGC output (browser or not), off for the LLVM lane. */
  interfaceClassArms?: boolean;
  /** The strict frontend. The strict family the lowering depends on (strict, strictNullChecks, strictFunctionTypes,
   * strictBindCallApply, strictPropertyInitialization, noImplicitThis, alwaysStrict, useUnknownInCatchVariables) is
   * always required: a tsconfig that turns one off fails with SC0002. This option forces more:
   * - `noImplicitAny`: implicit `any` becomes the checker's own error at each site, whatever the tsconfig says;
   * - `trap`: a value of type `any` the checker did not pin (an implicit-any binding, an `any` member or return of a
   *   declaration) that the lowering would carry as a dynamic value or island handle is refused at its source site
   *   (SC1200) instead of lowering silently;
   * - `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`: forced on whatever the tsconfig says.
   * `true` means `{ noImplicitAny: true, trap: true }`. Default: off; SCRIPTC_STRICT_FRONTEND ("1", or the object as
   * JSON) sets it for a build that passes no value. */
  strictFrontend?: boolean | { noImplicitAny?: boolean; trap?: boolean; noUncheckedIndexedAccess?: boolean; exactOptionalPropertyTypes?: boolean };
  /** Experimental browser/native profile (off by default; CHANGES WHAT PAGE
   * JAVASCRIPT OBSERVES). A compiled object or array stored on a page object
   * (`node[key] = value`, React-DOM's fiber and props expandos on DOM nodes)
   * is stored as an opaque reference instead of a live Proxy facade, unless
   * it already has a facade. The key itself is unchanged (`in`, enumeration,
   * `delete`, a frozen node's TypeError), and compiled code reading the key
   * back gets the same value. Page JavaScript reading it sees an opaque
   * WebAssembly object (no properties, not the facade other crossings of the
   * same value produce). Saves a Proxy, its target and two brand stamps per
   * store. */
  experimentalOpaquePageExpandos?: boolean;
  /** WasmGC: fuse `if (ref.test T x)` whose arm casts `x` to T into one br_on_cast (off by default). Each fused pair is one type
   * check instead of two; the module grows slightly (about 0.8% after -O2) and a large build takes a few seconds longer. Under
   * V8 the fused code measured no faster; it is meant for an ahead-of-time native build (Cranelift) that keeps every check. */
  fuseTestCasts?: boolean;
  /** WasmGC: a module that never runs on a JavaScript page (the native host: a compiled value crosses as itself, and nothing
   * calls a page facade's members) emits no per-type facade exports (records', classes' and arrays' accessors and methods).
   * Each export keeps its function alive through optimization and costs an ahead-of-time entry trampoline. Off by default:
   * a hostHandles module run by the web host (the gate's browser lanes) still builds its facades through them. */
  noPageFacades?: boolean;
  /** WasmGC: Math.sin/cos/tan/asin/acos/atan/atan2/exp/expm1/log/log1p/log2/log10/pow/sinh/cosh/tanh/asinh/acosh/atanh/cbrt are
   * compiled into the module (V8's fdlibm, only the routines a program reaches), not imported as `math.*` host members. The
   * results are the same on every host. On by default; `false` (or SCRIPTC_WASMGC_HOST_MATH=1) takes them from the host again.
   * `Math.random` is always the host's. */
  inModuleMath?: boolean;
  /** Experimental WasmGC option (off by default; RESULTS MAY DIFFER IN THE
   * LOW BITS): the SIMD library's `relaxed_*` operations (f32x4.relaxed_madd,
   * relaxed_nmadd) lower to Relaxed SIMD instructions instead of their
   * deterministic mul-then-add form, so a multiply-add may be fused (one
   * rounding) and its result may differ from the library's scalar fallback
   * and between machines, within the relaxed-SIMD contract. The module then
   * requires Relaxed SIMD: Chrome 114+, Firefox 145+, Node 21+; Safari
   * rejects it (JavaScriptCore keeps relaxed SIMD behind a flag). */
  experimentalRelaxedSimd?: boolean;
  /** Experimental browser/native profile (off by default): objects built by a
   * recognized JS constructor (an ordinary function whose body starts with
   * assignments of constant property names on `this`) are WasmGC structs with
   * a field per property (i32 for properties initialized with an int32
   * constant, or that the site profile saw hold only Smis); property sites
   * read and write the field behind one global test and one type test,
   * unboxed for int consumers. Every generic operation keeps JS semantics:
   * one the fields cannot serve (a new key, a delete, an attribute change, a
   * value an i32 field cannot hold) converts that object to an ordinary one,
   * after which the constructor's other objects keep only their dispatcher
   * paths. See backend/wasmgc/ctor-structs.ts. */
  experimentalJsConstructorStructs?: boolean; // default on for browser native WasmGC without a shared runtime (2026-10-16); false opts out
  /** Experimental, with experimentalJsConstructorStructs and a site profile (off by default):
   * object literals sharing one list of distinct constant keys get a struct of their own when
   * the profile saw plain objects of that layout (with a counted profile, at least 1000 guard
   * hits), and behave as constructor structs from there. See backend/wasmgc/ctor-structs.ts. */
  experimentalJsLiteralStructs?: boolean;
  /** Experimental, browser native dyn (off by default): run the points-to analysis (ir/points-to.ts,
   * hint mode) at compile time. Its facts only choose guarded code: a struct field every value of
   * which it sees as an int32 is an i32 field, and static constructor arms keep the constructors a
   * site's receivers can be. Costs compile time (seconds on React). */
  experimentalJsPointsTo?: boolean;
  /** Experimental browser/native profile (off by default): a dyn number that
   * is an integer in [-2^30, 2^30) (not -0) is an i31ref instead of a heap
   * box, and every such integer is (one canonical representation); other
   * numbers keep their box. Observable behavior is unchanged: every dyn
   * consumer (typeof, equality, ToNumber, keys, JSON, Map/Set SameValueZero,
   * page crossings) reads either form. V8 internalizes JS Smis to i31ref, so
   * page integers cross without a box in either direction. */
  experimentalDynI31?: boolean;
  /** Experimental browser/native profile (off by default; CHANGES WHAT PAGE
   * JAVASCRIPT OBSERVES, see backend/wasmgc/dom-mirror.ts): DOM nodes compiled
   * code creates through `document.createElement` / `createTextNode` /
   * `createComment` get a Wasm-side mirror. Compiled code holds the mirror
   * (the page still sees the node itself), so `===`, Map keys and reads such
   * as nodeType, ownerDocument, parentNode, firstChild, lastChild,
   * nextSibling and previousSibling are answered in Wasm while no page
   * JavaScript can have run since the mirror learned them; mutations the
   * mirror can prove run no page code (inert elements, primitive arguments,
   * the DOM's own methods) skip the invalidation. Assumptions: the DOM's own
   * accessors for the mirrored members are not overridden on mirrored nodes,
   * and no legacy mutation event listener observes them. On a mirrored node a
   * key no DOM interface defines (React's `__reactFiber$…`) is compiled
   * code's own: such expandos live in Wasm, page JavaScript no longer sees
   * them, and compiled code no longer sees page-set properties of such keys. */
  experimentalDomMirror?: boolean;
  /** Native-host builds (docs/HOST_IMPORT_ABI.md §5/§7): page nodes arrive as the host's
   * handle struct; compiled-value tests treat it as a page value. */
  hostHandles?: boolean;
  /** Production builds: runtime text carries no source sites. Refusal and fence messages drop their
   * `at <file>:<line>` suffix, and a module namespace's runtime id string is an opaque hash instead of its
   * `file:<absolute path>`. Compile-time diagnostics are unchanged. */
  stripSourceSites?: boolean;
  /** Source paths in runtime text (stack frames, refusal and fence messages) with a prefix replaced, as a C
   * compiler's `-ffile-prefix-map` does: `[["/home/me/project/", ""]]` makes them relative to the project. The first
   * matching `[from, to]` applies (`/` separators; a `from` with a drive letter matches without regard to case).
   * Compile-time diagnostics are unchanged. Ignored where stripSourceSites leaves no path. */
  sourcePathPrefixMap?: readonly (readonly [string, string])[];
  /** WasmGC output: also write `<out>.map`, a source map from the module's code to the original sources (statement
   * locations and calls), and a `sourceMappingURL` custom section naming it. Off by default: the module is then
   * byte-identical to a build without the option. Environment: SCRIPTC_WASMGC_SOURCE_MAP=1. `sources` are the file
   * paths the compiler read; a build script rewrites them to URLs. */
  sourceMap?: boolean;
  /** With sourceMap: the URL the module's sourceMappingURL section names (default `<out file name>.map`). A page that instantiates
   * from bytes (WebAssembly.compile of a fetched ArrayBuffer) has a `wasm://` script URL a relative name cannot resolve against:
   * give the map's absolute URL. Environment: SCRIPTC_WASMGC_SOURCE_MAP_URL. */
  sourceMapUrl?: string;
  /** With sourceMap: embed each source's text (`sourcesContent`; larger maps). Environment: SCRIPTC_WASMGC_SOURCE_MAP_CONTENT=1. */
  sourceMapContent?: boolean;
  /** Typed host modules (HOST_IMPORT_ABI section 7): an ambient `declare module "scheme:name"` the typed ABI cannot express (a non-function export, an
   * unmappable parameter or result) is a compile-time refusal. Off (default): such a module stays on the untyped page-module path (island.import). */
  strictHostModules?: boolean;
  /** Browser native WasmGC (GC_DISCOVERY.md; default 5 for profile-guided browser native WasmGC
   * without a shared runtime, else 0, DEFAULT_DYN_INLINE_SLOTS in index.ts; 0 turns it off):
   * the first N property slots of every native object are fields of the
   * object itself (dyn:obj {shape, slots, proto, js, s0..sN-1}) instead of
   * elements of a separate slot array, so an object with at most N
   * properties is one allocation instead of two (V8's in-object properties).
   * Slots past N live in the overflow array. Unobservable: only the layout
   * changes. 0 keeps every slot in the array. 1..16. */
  experimentalDynInlineSlots?: number;
  /** Restrict the experimental read path to these constant property names. */
  experimentalJsSpecializeProperties?: readonly string[];
  /** Separate diagnostic lane: export guard-hit/fallback counters (guarded:
   * per dispatcher, exported globals; profile: per guarded site, __pgo_sites()
   * and __pgo_count(i), entries at 2k and fallbacks at 2k + 1 for the site
   * whose report entry has counter k). */
  experimentalJsSpecializeCounters?: boolean;
  /** wasmgc RELEASE build (docs: WASMGC_RELEASE_CONTRACT.md): an optimized
   * artifact or an actionable failure. Any reachable compiler-generated
   * unsupported-operation fence fails the build (one diagnostic per site),
   * and a capability manifest (`<out>.manifest.json`) is written beside the
   * artifact. Exploratory builds (the default) keep fences as runtime errors:
   * in JavaScript sources, a construct the wasmgc backend cannot emit fences
   * at the innermost expression (else statement, else function) holding it,
   * a TypeError naming the construct when that code runs; TypeScript sources
   * stay compile errors. `<out>.fences.json` lists every fence of the build. */
  release?: boolean;
  /** wasmgc: the module's link contract for merging into one binary (see WasmGcLink). */
  wasmLink?: {
    namespace?: string;
    ffiModule?: string;
    imports?: Record<string, string | { module: string; name: string }>;
    memory?: { module: string; name: string; shared?: boolean };
    allocator?: { module: string; alloc: string; free: string };
    exports?: string[];
    /** JSPI: link exports wrapped with WebAssembly.promising (see WasmGcLink). */
    promising?: string[];
    /** Runtime kernels a linked Rust std module provides (see WasmGcLink). */
    kernels?: { fmod?: { module: string; name: string } };
    /** Experimental discrete library compilation: dyn values cross modules (see WasmGcLink). */
    sharedRuntime?: { role: "owner" } | { role: "client"; owner: string; atoms: string[] };
  };
  /** Experimental separate compilation (link/object.ts, docs-draft/OBJECT_FILES_POC.md): lower the entry as one object
   * unit. Symbols are tagged by their file's path relative to `root` instead of by its position in the program, and the
   * entry's own declarations are reachability roots. Only `compileObject` and `compileProgramObjects` set it. */
  objectUnit?: ObjectUnit;
  /** With `outputKind: "ir"`: the lowered module is handed here instead of being written to `outPath`. A whole program's
   * IR can exceed V8's longest string as JSON; compileProgramObjects partitions it in memory. */
  objectIrSink?: (mod: IrModule) => void;
  /** LLVM is the production code generator. */
  backend?: "llvm";
  /** Native optimization posture. Release is the shipped -O2 default; dev
   * uses -O0, source line tables, and stable multi-TU object caching for
   * large LLVM programs. Darwin executables include an adjacent .dSYM. */
  optimization?: "release" | "dev";
  /** Remove symbol/debug payload from an executable at link time. */
  strip?: boolean;
  /** Give the executable an x86-64-v3 copy of each program function, which
   * it runs instead of the baseline code on CPUs that support that level
   * (`SCRIPTC_CPU_LEVEL` caps the level at run time). Executables for x86-64
   * targets only; off by default. */
  cpuDispatch?: boolean;
  /** Windows PE executable subsystem. Console is the default; GUI suppresses
   * automatic console-window creation. Only valid for Windows executables. */
  windowsSubsystem?: WindowsSubsystem;
  /** --npm-static: package names whose shipped, unminified JS compiles
   * STATICALLY as program modules (inference types the bodies; statements
   * the lowering cannot prove become runtime fences). "auto" opts in every
   * directly-imported package passing the eligibility heuristics (own
   * .d.ts, unminified JS, no build-transform markers). A package whose
   * preflight refuses marks itself an offender and falls back to the
   * island (--dynamic) or the requires-dynamic diagnostic (static builds)
   * — never a silent misbuild. Off by default: nothing changes without
   * the flag. */
  npmStatic?: readonly string[] | "auto";
  /** Outbound native FFI manifest. Its signature-only TypeScript bindings
   * lower to direct C ABI calls. Source outputs retain those declarations;
   * archive/system-library inputs join only an executable link. */
  ffiProfilePath?: string;
  /** Attach the machine-readable external link recipe to an object result.
   * Valid only with outputKind "obj"; it never invokes a linker. */
  nativeLinkInfo?: boolean;
  /** LLVM lane, one program among several in one process (a piece of the threaded client): the program's entry
   * function and whether it runs the event loop. `symbol` replaces `main` (same signature, `int (int argc, char
   * **argv)`); with `runsLoop: false` the entry runs the program's top-level code and returns 0 (1 on an uncaught
   * throw) without running the loop, so a later entry on the same thread runs the loop that serves both (the runtime
   * keeps one loop per thread under SCR_THREAD_INSTANCES). Absent: the classic `main` that runs the loop. */
  nativeEntry?: { symbol: string; runsLoop: boolean };
  /** LLVM lane: entry-module functions exported as C symbols for another program in the same process to call (a
   * piece's seam: the WasmGC lane's wasmLink.exports). Each entry is a seam manifest's function (`*.link.json`):
   * `name` the function's IR name, `symbol` the C symbol, `params` per-argument classes -- f64 (double), u32, i32,
   * bool (uint8_t), bytes (pointer + length, copied in), mutable-bytes (pointer + length, a Uint8Array viewing the
   * caller's memory in place) -- and `returns` void, f64 or bool. A throw escaping the function is reported as
   * uncaught. The functions must be synchronous. */
  nativeExports?: readonly { name: string; symbol: string; params: readonly string[]; returns: string }[];
}

/** Executable compile options. This remains the compatibility type for the
 * historical compile() API, whose omitted output kind means executable. */
export interface CompileOptions extends CompileBaseOptions {
  outputKind?: "exe";
  /** Internal validation lane retained for helper-object artifact tests.
   * Supported ordinary LLVM executable builds select this path automatically. */
  nativeProgramObject?: boolean;
}

/** Source-artifact compile options, discriminated by the required kind. */
export interface CompileSourceOptions extends CompileBaseOptions {
  outputKind: Exclude<CompileOutputKind, "exe">;
}

/** Internal/dynamic request shape for callers that select the kind at runtime.
 * Statically executable/source callers should prefer the narrower interfaces. */
export interface CompileRequestOptions extends CompileBaseOptions {
  outputKind?: CompileOutputKind;
  /** Internal validation lane for executable requests. */
  nativeProgramObject?: boolean;
}

export type CompileArtifact =
  | { kind: "ir"; path: string }
  | {
      kind: "wasmgc"; path: string;
      /** Async/generator frame liveness: resume functions pruned, kept whole (a node the pass cannot see; the counts are by Binaryen
       * expression id), and dead reference slots cleared at a suspension. */
      asyncLiveness?: { pruned: number; kept: number; slotsCleared: number; opaqueKinds: Record<number, number> };
      /** What the release optimisation ran: tool hashes, ordered arguments, the staged path taken (emitter.ts WasmOptReceipt). */
      optimizer?: WasmOptReceipt;
      /** Wall time per backend phase, ms (emitter.ts WasmGcEmitResult.phases), generated helpers' share, and the artifact writes. */
      emitPhases?: Record<string, number>;
      emitHelpers?: { count: number; ms: number };
      /** SCRIPTC_WASMGC_DEFER_FINISH: the wasm-opt passes the caller still owes the module (WasmGcEmitResult.pendingFinish). */
      pendingFinish?: string[];
      writeMs?: number;
    }
  | { kind: "llvm"; path: string }
  | { kind: "asm"; path: string }
  | { kind: "obj"; path: string; nativeLinkInfo?: NativeLinkInfo }
  | {
      kind: "exe";
      path: string;
      translationUnitPath: string;
      backend: "llvm";

    };

export type CompileFailure = {
  ok: false;
  diagnostics: ScrDiagnostic[];
  sourceTexts: Map<string, string>;
};

export type CompileSourceResult =
  | { ok: true; artifact: Extract<CompileArtifact, { kind: "ir" | "wasmgc" | "llvm" | "asm" | "obj" }> }
  | CompileFailure;

/** Historical executable result shape retained for source compatibility. */
export type CompileResult =
  | {
      ok: true;
      binaryPath: string;
      llvmPath: string;
      irPath?: string;
      backend: "llvm";

    }
  | CompileFailure;

export type CompileExecutableResult =
  /** The generated LLVM source is retained beside the executable. */
  | (Extract<CompileResult, { ok: true }> & {
      artifact: Extract<CompileArtifact, { kind: "exe" }>;
    })
  | CompileFailure;

/** Result union for callers that choose outputKind dynamically. */
export type CompileRequestResult = CompileSourceResult | CompileExecutableResult;

export interface CompileLibraryOptions {
  profilePath: string;
  /** Where the archive and the kept program TU land. */
  outDir: string;
  /** Artifact path. Default: <stem>.lib.a, or <stem>.wasm for wasm32-wasi. */
  outPath?: string;
  emitIr?: boolean;
  sanitize?: boolean;
}

export type CompileLibraryResult =
  /** `sidecarPath` is present exactly when the profile declares a
   * `sidecar` section: the contract JSON written beside the archive by
   * the same invocation (ask 2). */
  | { ok: true; archivePath: string; llvmPath: string; backend: "llvm"; irPath?: string; sidecarPath?: string }
  | { ok: false; diagnostics: ScrDiagnostic[]; sourceTexts: Map<string, string> };

export interface AnalyzeOptions {
  /** Analyze as a --dynamic build (island constructs lower instead of
   * producing requires-dynamic diagnostics). */
  dynamic?: boolean;
  /** --npm-static (see CompileOptions.npmStatic): the analysis compiles
   * opted-in packages' JS as program modules and the coverage report
   * carries each package's static/fallback status. */
  npmStatic?: readonly string[] | "auto";
  /** Analyze with the outbound native bindings from this FFI manifest. */
  ffiProfilePath?: string;
  /** Coverage-only external host type surfaces: exact bare module
   * specifier → local declaration file. The checker uses the declarations
   * to analyze project code, but imported runtime values remain explicit
   * SC1010 blockers rather than being counted as executable. */
  externalTypes?: Readonly<Record<string, string>>;
  /** Analyze for the browser target (WasmGC), as `compile`'s `browser`
   * does: lowering follows that target's rules and the analysis is dynamic. */
  browser?: boolean;
  /** With `browser`: the dynamic-value model, as `compile`'s `dynModel`. */
  dynModel?: "engine" | "native";
  /** Extra package resolution conditions, as `compile`'s `conditions`. */
  conditions?: readonly string[];
  /** As `compile`'s `interfaceClassArms`. */
  interfaceClassArms?: boolean;
  /** As `compile`'s `strictFrontend`. */
  strictFrontend?: CompileBaseOptions["strictFrontend"];
  /** As `compile`'s `experimentalTsNativeAny` (needs `browser` and the native `dynModel`):
   * the production recipe's TS `any` representation, so a census matches the shipped build. */
  experimentalTsNativeAny?: boolean;
}

export interface AnalyzeResult {
  coverage: CoverageInput;
  sourceTexts: Map<string, string>;
}
