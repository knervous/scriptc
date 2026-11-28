export interface CompileOptions {
  /** Where to write the module. Default: the entry with a `.wasm` extension. Its host sidecar, the list of host
   * imports it uses, is written beside it as `<outPath>.host.json`. */
  outPath?: string;
  /** A page program: DOM, timers and typed `host:` modules, for a web page to load with `scriptw/host`. */
  browser?: boolean;
  /** A release build. */
  release?: boolean;
  /** Capability modes: `auto` (the default), `baseline` or `compat`, and/or a list such as
   * `eh=legacy,views=fixed:128,relaxed-simd,threads=auto,-jspi`. `auto` builds one compat variant
   * (`<out>.compat.wasm`) only when a target needs it and the program uses the feature that differs. */
  capabilities?: string;
  /** The engines to support. Default `chrome>=137,firefox>=134,safari>=26.2,node>=24.15`. */
  targets?: string | string[];
  /** Package export and import conditions to add, such as `dom-stream`. `wasmgc` is always on: a package that maps it
   * to TypeScript source (`"wasmgc": "./src/index.ts"`) is compiled into the module from that source. */
  conditions?: string[];
  /** npm packages to compile into the module: their JavaScript is compiled with the program rather than loaded as npm
   * JavaScript. A package the compiler cannot take this way either stays npm JavaScript (with a note on stderr) or
   * fails the build with its diagnostics. */
  compilePackages?: string[];
  /** With `compilePackages` and `browser`: whether the program's `any` values are compiled values (the default,
   * `true`), as the compiled-in packages' values are, or page values (`false`, the representation without
   * `compilePackages`). */
  nativeAny?: boolean;
  /** With `browser`: how dynamic values are represented. `native` (the default) compiles them as WasmGC values, which
   * UI libraries and frameworks need; `engine` keeps them as engine values behind host calls, for the smallest module. */
  dynModel?: "native" | "engine";
}

export type Requirement =
  | "wasm-gc" | "exnref" | "legacy-eh" | "simd" | "relaxed-simd"
  | "js-string-builtins" | "imported-string-constants"
  | "resizable-memory-buffer" | "jspi" | "shared-memory" | "cross-origin-isolation";

/** The resolved capabilities of a built module (also in `<out>.wasm.capabilities.json` and the module itself). */
export interface ResolvedCapabilities {
  schema: "wgc-cap/1";
  key: string;
  mode: { eh: "exnref" | "legacy"; views: "resizable" | `fixed:${number}`; relaxedSimd: boolean; threads: "off" | "shared" | "auto" };
  variant: "preferred" | "compat";
  requires: Requirement[];
}

export interface Diagnostic {
  message: string;
  /** The compiler's diagnostic code, such as `SC1001`, when it has one. */
  code?: string;
  file?: string;
  /** The 1-based line in `file`. */
  line?: number;
  /** How to change the program, when the compiler has a suggestion. */
  hint?: string;
}

export type CompileResult =
  | {
      ok: true;
      wasmPath: string;
      hostSidecarPath: string;
      /** `<out>.wasm.capabilities.json`. */
      capabilitiesPath: string;
      capabilities: ResolvedCapabilities;
      /** Preferred first; a second entry when a compat variant was built. */
      variants: { wasmPath: string; key: string; requires: Requirement[] }[];
      /** `<out>.wasm.variants.json`, present when there are two variants. */
      variantsPath?: string;
      /** Why each capability was chosen. */
      explainCapabilities: string[];
    }
  | { ok: false; diagnostics: Diagnostic[] };

/** Compiles a TypeScript or JavaScript entry and everything it imports to one WasmGC module. */
export function compile(entry: string, options?: CompileOptions): Promise<CompileResult>;

/** A diagnostic as text: `file:line: code: message`, with the parts it has, and its hint on a second line. */
export function formatDiagnostic(diagnostic: Diagnostic): string;

/** The hard WebAssembly features this engine lacks to run scriptw's modules (WasmGC, exception handling), by name;
 * empty when it has them all. */
export function missingWasmFeatures(): string[];

/** The plain-JavaScript fallbacks the loader takes on this engine (`strings:constants`, `strings:polyfill`). */
export function wasmFallbacks(): string[];

/** A message naming the missing features and the Node.js release that has them, or null when none is missing. */
export function unsupportedRuntimeMessage(): string | null;
