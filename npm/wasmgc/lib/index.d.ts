export interface CompileOptions {
  /** Where to write the module. Default: the entry with a `.wasm` extension. Its host sidecar, the list of host
   * imports it uses, is written beside it as `<outPath>.host.json`. */
  outPath?: string;
  /** A page program: DOM, timers and typed `host:` modules, for a web page to load with `scriptw/host`. */
  browser?: boolean;
  /** A release build. */
  release?: boolean;
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
  | { ok: true; wasmPath: string; hostSidecarPath: string }
  | { ok: false; diagnostics: Diagnostic[] };

/** Compiles a TypeScript or JavaScript entry and everything it imports to one WasmGC module. */
export function compile(entry: string, options?: CompileOptions): Promise<CompileResult>;

/** A diagnostic as text: `file:line: code: message`, with the parts it has, and its hint on a second line. */
export function formatDiagnostic(diagnostic: Diagnostic): string;

/** The WebAssembly features this engine lacks to run scriptw's modules, by name; empty when it has them all. */
export function missingWasmFeatures(): string[];

/** A message naming the missing features and the Node.js release that has them, or null when none is missing. */
export function unsupportedRuntimeMessage(): string | null;
