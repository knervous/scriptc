/** Options for {@link instantiateWasmGc}. Every field is optional. */
export interface WasmGcHostOptions {
  /** Where `console.log`, `console.info` and `console.debug` go in a program built without `--browser`. Default:
   * the engine's `console.log`. A page program (`--browser`) uses the page's own `console`. */
  log?: (...values: unknown[]) => void;
  /** Where `console.error` and `console.warn` go in a program built without `--browser`. Default: the engine's
   * `console.error`. */
  error?: (...values: unknown[]) => void;
  /** An exception escaping a timer callback or a microtask drain. Default: the engine's own report. */
  onUncaught?: (error: unknown) => void;
  /** Modules the program imports but does not compile, by specifier: typed `host:` modules (`"host:clock"`) and npm
   * packages a page program keeps as JavaScript. Each is a namespace object of functions and values. */
  modules?: Record<string, Record<string, unknown>>;
  /** `import(key)` of a module outside the program: a loader answering its namespace (else `modules[key]`). */
  importModule?: (key: string) => Promise<unknown>;
  /** `import.meta.env`, for a page program built against a bundler's build-time environment. */
  env?: Record<string, unknown>;
  /** The most promise-returning host calls admitted at once; a call beyond it rejects with a busy error. Default 64. */
  promisingLimit?: number;
}

/** An instantiated module. */
export interface WasmGcInstance {
  /** The WebAssembly instance. */
  instance: { exports: Record<string, unknown> };
  /** Runs the program's top level. A module with top-level await returns its evaluation promise. */
  main(): void | Promise<void>;
  /** Timers still scheduled (set, not yet fired or cleared) that keep the program alive, as in Node. */
  pendingTimers(): number;
  /** Cancels every scheduled timer. */
  stopTimers(): void;
}

/** Compiles and instantiates a module scriptw built, with its host imports. Call `main()` on the result to run it. */
export function instantiateWasmGc(binary: Uint8Array, opts?: WasmGcHostOptions): Promise<WasmGcInstance>;
