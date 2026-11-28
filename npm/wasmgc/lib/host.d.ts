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
  /** `auto` (the default): a capability the engine lacks but the loader can supply (the JS String Builtins and
   * imported string constants) is supplied from plain JavaScript and listed in `capabilities.fallbacks`. `strict`:
   * refuse instead. */
  capabilities?: "auto" | "strict";
  /** How strings are served: `auto`, `engine` (refuse when the engine lacks them), `constants` (the engine's builtins,
   * the string constants as an ordinary import module) or `polyfill` (no engine string support). */
  strings?: "auto" | "engine" | "constants" | "polyfill";
}

/** An engine capability a module can require. The two string capabilities are soft: the loader supplies them. */
export type Requirement =
  | "wasm-gc" | "exnref" | "legacy-eh" | "simd" | "relaxed-simd"
  | "js-string-builtins" | "imported-string-constants"
  | "resizable-memory-buffer" | "jspi" | "shared-memory" | "cross-origin-isolation";

/** The capability mode a module was built under. */
export interface CapabilityMode {
  eh: "exnref" | "legacy";
  views: "resizable" | `fixed:${number}`;
  relaxedSimd: boolean;
  threads: "off" | "shared" | "auto";
}

/** What a module records about itself (its `scriptc.capabilities` section, and `<out>.wasm.capabilities.json`). */
export interface ResolvedCapabilities {
  schema: "wgc-cap/1";
  /** The canonical mode key, for example `wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=off`. */
  key: string;
  mode: CapabilityMode;
  variant: "preferred" | "compat";
  requires: Requirement[];
}

/** What this engine and page offer, by probe (each probe is a module of a few dozen bytes, validated, never run). */
export type EngineCapabilities = Record<Requirement, boolean> & { sharedArrayBuffer: boolean; atomicsWaitAsync: boolean };

/** What an instance needed, what the engine offered, and each fallback taken (`strings:constants`,
 * `strings:polyfill`). `required` is null for a module built before capabilities were recorded. */
export interface InstanceCapabilities {
  required: ResolvedCapabilities | null;
  provided: EngineCapabilities;
  fallbacks: string[];
}

/** A variant set (`<out>.wasm.variants.json`): artifacts in order of preference. */
export interface VariantSet {
  schema: "wgc-variants/1";
  variants: { file: string; key: string; requires: Requirement[] }[];
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
  /** What the module needed, what the engine offered, and the fallbacks taken. */
  capabilities: InstanceCapabilities;
}

/** Compiles and instantiates a module scriptw built, with its host imports. Call `main()` on the result to run it. */
export function instantiateWasmGc(binary: Uint8Array, opts?: WasmGcHostOptions): Promise<WasmGcInstance>;

/** Loads a module by URL: a variant set (`app.wasm.variants.json`, of which only the first variant this engine runs
 * is downloaded) or a `.wasm` (with its variant set when one sits beside it). `read` replaces `fetch`, for example for
 * file: URLs under Node. */
export function loadWasmGc(source: string | URL, opts?: WasmGcHostOptions & { read?: (url: URL) => Promise<Uint8Array | ArrayBuffer> }): Promise<WasmGcInstance & { variant: string }>;

/** The first variant of a set this engine runs; throws, naming each variant's gap, when none does. */
export function chooseVariant(set: VariantSet, caps?: EngineCapabilities): VariantSet["variants"][number];

/** This engine's capabilities, probed once per realm (`fresh` probes again). */
export function detectCapabilities(fresh?: boolean): EngineCapabilities;

/** The capabilities a module records, from its bytes or a compiled `WebAssembly.Module`; null for an older module. */
export function requiredCapabilities(module: Uint8Array | object): ResolvedCapabilities | null;

/** What the page offers for a shared-memory (threaded) deployment. */
export interface DeploymentCapabilities {
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  atomics: boolean;
  atomicsWaitAsync: boolean;
  sharedWasmMemory: boolean;
  growableSharedViews: boolean;
  jspi: boolean;
}
export function deploymentCapabilities(): DeploymentCapabilities;
/** Throws an actionable error (naming COOP/COEP when the page is not isolated) unless every `required` entry holds. */
export function requireDeploymentCapabilities(required?: (keyof DeploymentCapabilities)[]): DeploymentCapabilities;

/** Statuses the task ring writes itself, and its claim/publish refusals. */
export const STATUS_CANCELLED: -3, STATUS_STALE: -4, STATUS_FAILED: -5;
export const RING_FULL: -1, RING_STOPPED: -2, RING_BAD_PUBLISH: -3;

export interface TaskRingLayout {
  /** Tasks in flight. Default 8. */
  slots?: number;
  /** Bytes per payload region, a multiple of 16. Default 64 KiB. */
  payloadBytes?: number;
}

/** Runs one task: the first `length` bytes of `payload` are its input. Answers a status (0 for success) and a result. */
export type TaskRunner = (entry: number, payload: Uint8Array, length: number, work: number) => { status: number; result: number };

export interface TaskRingOptions extends TaskRingLayout {
  /** `off`: the consumer is a task on this thread. `shared`: a consumer thread (needs `startConsumer` and shared
   * memory, which a page has only when cross-origin isolated). `auto` (the default): `shared` when possible, else `off`. */
  threads?: "auto" | "off" | "shared";
  /** The task runner, for `off` and for `auto`'s fallback. */
  run?: TaskRunner;
  /** Starts a consumer thread (a Worker that calls `runTaskConsumer` with these arguments). */
  startConsumer?: (buffer: SharedArrayBuffer, byteOffset: number, layout: Required<TaskRingLayout>) => void;
  buffer?: ArrayBufferLike;
  byteOffset?: number;
}

/** A bounded single-producer/single-consumer task ring. Both threads modes run the same protocol: the same tasks
 * give the same ids, statuses, results, refusals and order; only timing differs. */
export interface TaskRing {
  readonly threads: "shared" | "off";
  readonly buffer: ArrayBufferLike;
  readonly byteOffset: number;
  readonly slots: number;
  readonly payloadBytes: number;
  /** The next slot to fill, `RING_FULL` or `RING_STOPPED`. */
  claim(): number;
  payload(slot: number): Uint8Array;
  /** The task id, or `RING_BAD_PUBLISH`. */
  publish(slot: number, entry: number, length: number, work: number): number;
  /** Reaps completed tasks in submission order: how many. */
  reap(done: (taskId: number, status: number, result: number) => void): number;
  /** Tasks completed so far: read it before reaping, then wait from it. */
  completed(): number;
  waitForCompletion(seen: number): Promise<void>;
  /** No new tasks; queued ones settle as `STATUS_CANCELLED`. */
  stop(): void;
  /** Holds the consumer between tasks while set. */
  hold(on: boolean): void;
  /** 0 idle, 1 running, 2 exited. */
  consumerState(): number;
}

export function createTaskRing(options?: TaskRingOptions): TaskRing;
/** The consumer thread's loop: call it in a Worker over the ring's memory. Returns once the ring is stopped. */
export function runTaskConsumer(buffer: SharedArrayBuffer, byteOffset: number, layout: TaskRingLayout, run: TaskRunner): void;
/** Bytes a ring of `layout` needs. */
export function taskRingBytes(layout?: TaskRingLayout): number;
