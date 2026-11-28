/* Host side of the WasmGC backend. The module imports `wasm:js-string`
 * builtins and string constants from the engine, and the `host` module for
 * intrinsics that are not compiled natively yet. Every `host` entry here is
 * a migration target: the emitter records which ones a program uses. */

import { memorySpan, moduleAddress } from "./address.js";
import { CAPABILITY_SECTION, decodeCapabilitySection, detectCapabilities, fixedMiB, missingRequirements, readCustomSections, refusalText, supportText, VARIANTS_SCHEMA, type EngineCapabilities, type ResolvedCapabilities, type VariantSet } from "./capabilities.js";
import { DATE_HOST_MEMBERS, DATE_LOCALE_METHODS, DATE_UTC_ARITIES } from "../../ir/date-host.js";

export interface WasmGcHostOptions {
  /** auto (the default): a capability the engine lacks but the host can supply (the JS String Builtins and imported
   * string constants) is supplied from plain JavaScript, and listed in the instance's `capabilities.fallbacks`.
   * strict: refuse instead. Any namespace asking strict makes the instance strict. */
  capabilities?: "auto" | "strict";
  /** How strings are served: auto (the engine's builtins and constants where it has them, plain JavaScript where it
   * does not), engine (the engine's only; refuse otherwise), constants (the engine's builtins, the constants as an
   * ordinary import module), polyfill (no engine string support at all). */
  strings?: "auto" | "engine" | "constants" | "polyfill";
  /** JSPI: the most promising calls admitted at once (running or queued)
   * across the whole instance; a call beyond it rejects at once with a busy
   * error. Default 64; the smallest value any namespace gives wins. */
  promisingLimit?: number;
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
  /** An exception escaping a timer callback or a microtask drain. Default:
   * the browser's own report (reportError / rethrow on a fresh task). */
  onUncaught?: (error: unknown) => void;
  /** Browser target: npm package namespaces by package name (the page's
   * bundler resolves and loads them; island.import reads exports here). */
  modules?: Record<string, Record<string, unknown>>;
  /** Host imports to serve from elsewhere, by import name: an embedder's own (a linked wasm module's exports, say,
   * which the engine calls wasm to wasm). `math.sin` from a native libm in place of the page's `Math.sin`. */
  hostOverrides?: Record<string, unknown>;
  /** import(key) of a module outside the program: a loader answering its namespace (else `modules[key]`). */
  importModule?: (key: string) => Promise<unknown>;
  /** Browser target: import.meta.env (Vite's build-time env, supplied at load). */
  env?: Record<string, unknown>;
}

/* The compiler's tsconfig carries no DOM/WebAssembly lib; type the engine
 * surface used here locally. */
interface WasmEngine {
  compile(bytes: Uint8Array, options: unknown): Promise<object>;
  Module: { imports(module: object): { module: string; name: string; kind?: string }[]; customSections?(module: object, name: string): ArrayBuffer[] };
  instantiate(module: object, imports: unknown): Promise<{ exports: Record<string, unknown> }>;
}
const engine = (globalThis as unknown as { WebAssembly: WasmEngine }).WebAssembly;

export interface WasmGcInstance {
  instance: { exports: Record<string, unknown> };
  /** What the module needed, what the engine offered, and the fallbacks taken. */
  capabilities: WasmGcInstanceCapabilities;
  /** A module with top-level await returns its evaluation promise. */
  main(): void | Promise<void>;
  /** Referenced timers still scheduled: a harness waits on this as Node's loop would. */
  pendingTimers(): number;
  /** Cancel every timer (a harness modelling process exit). */
  stopTimers(): void;
}

/* Property keys crossing as strings are in key form (dyn-object.ts KEY_MARK). A symbol interns, by identity, as a
 * reserved name "\uDFFF<id>:<description>" (a lone low surrogate, then a digit); a string key that itself begins
 * with U+DFFF carries one more U+DFFF in front, so no string key can spell a reserved name. Imports that take a
 * property key read it back with K: a reserved name becomes its symbol (an exact match, never a prefix), an escaped
 * string loses its extra U+DFFF, and any other string is itself, so the page always sees the key itself. */
const symbolIds = new Map<symbol, string>(), symbolsByName = new Map<string, symbol>();
/** SCRIPTC_WASMGC_NATIVE_SIM=1 (tests only): js.dynFacade (and js.recordFacade / js.classFacade / js.arrayFacade) answer the compiled value itself, as the native host does, so a facade-dependent path fails visibly. */
/** js.global.<name> reads the native host answers undefined for (SCRIPTC_WASMGC_NATIVE_SIM=1): builtins compiled code implements itself under hostHandles,
 * and the platform globals a native host does not supply (the scheduler's MessageChannel / setImmediate, requestIdleCallback, AbortController, queueMicrotask). */
const NATIVE_ABSENT_GLOBALS = new Set(["Array", "Object", "Function", "Number", "String", "Boolean", "BigInt", "Symbol", "JSON",
  "MessageChannel", "setImmediate", "clearImmediate", "requestIdleCallback", "cancelIdleCallback", "AbortController", "queueMicrotask"]);
/** The argument list of a call `f(...pre, ...spread)` with one spread source, with V8's call-spread TypeErrors: a
 * nullish source names its spelling, any other non-iterable the iterator method. (A host arrow spreading two lists
 * builds an array literal instead, whose TypeError is the array-spread text.) */
const spreadArguments = (pre: unknown[], spread: any, spelling: string): unknown[] => {
  if (spread === null || spread === undefined) throw new TypeError(`${spelling} is not iterable (cannot read property ${spread})`);
  if (typeof spread[Symbol.iterator] !== "function") throw new TypeError("Spread syntax requires ...iterable[Symbol.iterator] to be a function");
  return [...pre, ...spread];
};
const isPrimitiveReceiver = (o: unknown): boolean => { const t = typeof o; return t === "string" || t === "number" || t === "boolean" || t === "symbol" || t === "bigint"; };
const NATIVE_SIM = typeof process !== "undefined" && process.env?.["SCRIPTC_WASMGC_NATIVE_SIM"] === "1";
const symbolKey = (s: symbol): string => {
  let name = symbolIds.get(s);
  if (name === undefined) { name = `\uDFFF${symbolIds.size}:${String(s)}`; symbolIds.set(s, name); symbolsByName.set(name, s); }
  return name;
};
/** A property key from compiled code (key form): a reserved name becomes its symbol, an escaped string itself. */
const K = (k: any): any => typeof k !== "string" || k.charCodeAt(0) !== 0xDFFF ? k
  : k.charCodeAt(1) === 0xDFFF ? k.slice(1) : symbolsByName.get(k) ?? k;
/** A page property key in key form, for a compiled export that takes one (the inverse of K). */
const keyForm = (k: string | symbol): string => typeof k === "symbol" ? symbolKey(k) : k.charCodeAt(0) === 0xDFFF ? `\uDFFF${k}` : k;

const MATH_IMPORTS = [
  "sin", "sinh", "cos", "cosh", "tan", "tanh", "asin", "asinh", "acos", "acosh", "atan", "atanh",
  "cbrt", "exp", "expm1", "log", "log1p", "log2", "log10", "atan2", "pow", "random",
] as const;

/** Per-instance hooks the host needs after instantiation (the drain export). */
export interface WasmGcHostState {
  drain?: () => void;
  reportUnhandled?: () => void;
  /** The module's linear memory (typed-array storage) and its free export. */
  memory?: { buffer: ArrayBuffer };
  /** The memory never grows (capability views=fixed): its buffer never detaches, and byte views use it directly. */
  fixedMemory?: boolean;
  bytesFree?: (base: number) => void;
  timerFire?: (slot: number, repeat: number) => void;
  moduleDone?: (rejected: number, value: unknown) => void;
  /** Pending timers (scheduled, not yet fired or cleared). */
  timers?: Map<number, { id: unknown; slot: number; kind: number; ref: boolean }>;
  /** Set once an exception escaped: Node's process would have exited. */
  dead?: boolean;
  stopTimers?: () => void;
  /** Wasm exports the JS bridge calls back into (closure invokers, jsSettle). */
  exports?: Record<string, unknown>;
}

export function wasmGcHostImports(opts: WasmGcHostOptions = {}, state: WasmGcHostState = {}): Record<string, unknown> {
  const log = opts.log ?? console.log, error = opts.error ?? console.error;
  // Arguments are printed as they are evaluated; an argument may itself log,
  // so each console call gets its own frame on a stack.
  const frames: unknown[][] = [];
  let pending: unknown[] = [];
  const begin = () => { frames.push(pending); pending = []; };
  const end = (sink: (...values: unknown[]) => void) => { const values = pending; pending = frames.pop() ?? []; sink(...values); };
  const host: Record<string, unknown> = {
    "log.begin": begin,
    "log.end": () => end(log),
    "error.begin": begin,
    "error.end": () => end(error),
    "print.f64": (value: number) => { pending.push(value); },
    "print.bool": (value: number) => { pending.push(value !== 0); },
    "print.string": (value: string) => { pending.push(value); },
    "print.undefined": () => { pending.push(undefined); },
    "print.null": () => { pending.push(null); },
    // Uncaught-exception path until Wasm EH lands. kind follows the IR's
    // error.nodeThrow: 0 Error, 1 TypeError, 2 RangeError.
    "error.throw": (kind: number, code: string, message: string) => {
      const Ctor = [Error, TypeError, RangeError][kind] ?? Error;
      const error = new Ctor(message) as Error & { code?: string };
      if (code) error.code = code;
      throw error;
    },
    "num.toString": (value: number) => String(value),
    "date.now": () => Date.now(),
    "js.date.now.0": () => Date.now(),
    // The page's performance.now() as one typed clock read: evaluated live (a replaced performance or now() is what runs), and a
    // non-number answer is the same strict TypeError js.toNum gives.
    "perf.now": () => {
      const t: unknown = performance.now();
      if (typeof t !== "number") throw new TypeError(`expected number, got ${t === null ? "null" : typeof t}`);
      return t;
    },
    // Performance.now() (the typed js.dom.now.0 member): any receiver is called exactly as `o.now()`.
    "js.dom.now.0": (o: any) => o.now(),
    // window.reportError(x): the argument crosses as anyref (a page value is its own JS value).
    "js.win.reportError.1": (x: any) => {
      if (!("reportError" in globalThis)) throw new ReferenceError("reportError is not defined");
      (globalThis as any).reportError(x);
    },
    "str.encodeUriComponent": (v: string) => encodeURIComponent(v), "str.encodeUri": (v: string) => encodeURI(v),
    "str.decodeUriComponent": (v: string) => decodeURIComponent(v), "str.decodeUri": (v: string) => decodeURI(v),
    "str.fromCharCode": (code: number) => String.fromCharCode(code),
    "str.fromCharCodes": (codes: number[]) => String.fromCharCode(...codes),
    "num.fromString": (value: string) => Number(value),
    "num.parseInt": (value: string, radix: number) => parseInt(value, radix),
    "num.parseFloat": (value: string) => parseFloat(value),
    // Only consulted after the compiled parser rejects: V8's exact message.
    "json.errorMessage": (text: string) => { try { JSON.parse(text); return "Unexpected token"; } catch (e) { return (e as Error).message; } },
    "str.toUpperCase": (value: string) => value.toUpperCase(),
    "str.toLowerCase": (value: string) => value.toLowerCase(),
    "str.normalize": (value: string, form: string) => value.normalize(form),
    "str.isWellFormedNot": (value: string) => ((value as unknown as { isWellFormed(): boolean }).isWellFormed() ? 0 : 1),
    "num.toFixed": (value: number, digits: number) => value.toFixed(digits),
    "num.toExponential": (value: number, digits: number) => value.toExponential(digits),
    // Number/String/Symbol prototype members of a primitive receiver the compiled library has no algorithm for (hostHandles: typed members, never js.callMethod on a primitive).
    "num.toExponentialAuto": (value: number) => value.toExponential(),
    "num.toPrecision": (value: number, digits: number) => value.toPrecision(digits),
    "num.toLocaleString": (value: number, locales: string) => value.toLocaleString(locales === "" ? undefined : locales),
    "str.localeCompare": (value: string, that: string) => value.localeCompare(that),
    // bigint (a page bigint: an opaque externref to compiled code). binop codes: 0 add, 1 sub, 2 mul, 3 div, 4 mod, 5 pow, 6 and, 7 or, 8 xor, 9 shl, 10 shr
    // (RangeError on a zero divisor or a negative exponent, as JS); unop: 0 neg, 1 not; cmp answers -1, 0 or 1; cmpNumber is NaN against NaN.
    "bigint.parse": (text: string) => BigInt(text),
    // A wasm i64 arrives as a signed BigInt; unsigned reads reinterpret it as 64 bits.
    "bigint.fromI64": (v: bigint, unsigned: number) => (unsigned ? BigInt.asUintN(64, v) : v),
    // A bigint as a wasm i64: the JS API's ToBigInt64 takes its low 64 bits (the int intrinsics' 64-bit arguments).
    "bigint.toI64": (v: bigint) => v,
    "bigint.fromNum": (n: number) => BigInt(n),
    "bigint.from": (v: any) => BigInt(v),
    "bigint.toNum": (b: bigint) => Number(b),
    "bigint.toString": (b: bigint, radix: number) => b.toString(radix),
    "bigint.binop": (op: number, a: bigint, b: bigint): bigint => {
      switch (op) {
        case 0: return a + b; case 1: return a - b; case 2: return a * b; case 3: return a / b; case 4: return a % b; case 5: return a ** b;
        case 6: return a & b; case 7: return a | b; case 8: return a ^ b; case 9: return a << b; default: return a >> b;
      }
    },
    "bigint.unop": (op: number, a: bigint): bigint => (op === 0 ? -a : ~a),
    "bigint.cmp": (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0),
    "bigint.cmpNumber": (a: bigint, n: number) => (n !== n ? NaN : a < n ? -1 : a > n ? 1 : 0),
    "bigint.eqString": (a: bigint, text: string) => (a == (text as unknown as bigint) ? 1 : 0),
    "bigint.asN": (signed: number, bits: number, a: bigint) => (signed ? BigInt.asIntN(bits, a) : BigInt.asUintN(bits, a)),
    "js.symbolToString": (value: symbol) => value.toString(),
    "js.is.primitive": (v: any) => (v !== null && typeof v !== "object" && typeof v !== "function" ? 1 : 0),
    "js.symbolDescription": (value: symbol) => value.description,
    // Symbol(description) and Symbol.keyFor(sym) as typed members (the native host has no page Symbol global).
    // A compiled WeakMap / WeakSet on the web host is a real page WeakMap / WeakSet: typed members, keys by identity.
    "js.weakMapGet": (wm: WeakMap<object, unknown>, k: object) => wm.get(k),
    "js.weakMapSet": (wm: WeakMap<object, unknown>, k: object, v: unknown) => { wm.set(k, v); },
    "js.weakMapHas": (wm: WeakMap<object, unknown>, k: object) => (wm.has(k) ? 1 : 0),
    "js.weakMapDelete": (wm: WeakMap<object, unknown>, k: object) => (wm.delete(k) ? 1 : 0),
    "js.weakSetAdd": (ws: WeakSet<object>, k: object) => { ws.add(k); },
    "js.weakSetHas": (ws: WeakSet<object>, k: object) => (ws.has(k) ? 1 : 0),
    "js.weakSetDelete": (ws: WeakSet<object>, k: object) => (ws.delete(k) ? 1 : 0),
    "js.symNew": (description: string | undefined) => Symbol(description),
    "js.symKeyFor": (sym: symbol) => Symbol.keyFor(sym),
    "num.toStringRadix": (value: number, radix: number) => value.toString(radix),
    "math.fmod": (a: number, b: number) => a % b,
  };
  // Each compiled job runs in its own host microtask, so compiled promise
  // reactions interleave with the page's own promise jobs in FIFO order.
  const queue = (globalThis as unknown as { queueMicrotask: (f: () => void) => void }).queueMicrotask;
  const uncaught = (e: unknown) => {
    if (opts.onUncaught) { state.dead = true; for (const t of timers.values()) cancel(t); timers.clear(); opts.onUncaught(e); }
    else {
      // One report per exception: the page's reportError when it has one,
      // else a rethrow on a fresh task.
      const report = (globalThis as unknown as { reportError?: (e: unknown) => void }).reportError;
      if (typeof report === "function") report(e); else setTimeout(() => { throw e; });
    }
  };
  const guarded = (run: () => void) => { if (state.dead) return; try { run(); } catch (e) { uncaught(e); } };
  // A rejection still unhandled after a drain: Node ends the process; a
  // page reports it (the unhandledrejection analogue).
  host["async.unhandled"] = (reason: unknown) => uncaught(reason);
  // NATIVE_SIM: the native host coalesces the drain requests of one task into one drain call (a boolean flag), so a compiled drain that
  // ran a single job would strand the others.
  let drainRequested = false;
  host["async.scheduleDrain"] = NATIVE_SIM
    ? () => { if (drainRequested) return; drainRequested = true; queue(() => { drainRequested = false; guarded(() => state.drain?.()); }); }
    : () => queue(() => guarded(() => state.drain?.()));
  // A rejection with no handler yet: checked once the job queue is empty.
  // Like the page's own unhandledrejection, the check runs after the whole
  // microtask checkpoint (a later microtask may still attach a handler).
  let reportPending = false;
  host["async.scheduleReport"] = () => {
    if (reportPending) return;
    reportPending = true;
    setTimeout(() => { reportPending = false; guarded(() => state.reportUnhandled?.()); }, 0);
  };
  // Timers: Wasm owns the callback in a slot; the host owns the id. Each
  // firing runs the callback, then drains the microtasks it queued.
  const timers = new Map<number, { id: unknown; slot: number; kind: number; ref: boolean }>();
  state.timers = timers;
  state.stopTimers = () => { for (const t of timers.values()) cancel(t); timers.clear(); };
  let nextTimer = 1;
  const g = globalThis as unknown as { setTimeout(f: () => void, ms: number): unknown; setInterval(f: () => void, ms: number): unknown; clearTimeout(id: unknown): void; clearInterval(id: unknown): void };
  const cancel = (t: { id: unknown; kind: number }) => t.kind === 1 ? g.clearInterval(t.id) : g.clearTimeout(t.id);
  host["timers.set"] = (slot: number, ms: number, kind: number) => {
    const handle = nextTimer++;
    // Node clamps delays outside [1, 2^31-1] to 1 ms.
    const delay = kind === 2 ? 0 : !(ms >= 1 && ms <= 2147483647) ? 1 : ms;
    const fire = () => guarded(() => { if (kind !== 1) timers.delete(handle); state.timerFire!(slot, kind === 1 ? 1 : 0); });
    timers.set(handle, { id: kind === 1 ? g.setInterval(fire, delay) : g.setTimeout(fire, delay), slot, kind, ref: true });
    return handle;
  };
  // Node's loop liveness (ref/unref): a page never exits, but harnesses
  // that model Node's exit stop once no referenced timer remains.
  host["timers.setRef"] = (handle: number, ref: number) => { const t = timers.get(handle); if (t) t.ref = ref !== 0; };
  host["timers.hasRef"] = (handle: number) => (timers.get(handle)?.ref ? 1 : 0);
  host["timers.clear"] = (handle: number, kind: number) => {
    const t = timers.get(handle);
    // Timeouts and intervals share clearTimeout/clearInterval; immediates are their own space.
    if (!t || (t.kind === 2) !== (kind === 2)) return -1;
    cancel(t); timers.delete(handle);
    return t.slot;
  };
  host["async.moduleDone"] = (rejected: number, value: unknown) => {
    // A rejected top-level await ends the program, like an uncaught throw.
    if (rejected && opts.onUncaught) { state.dead = true; for (const t of timers.values()) cancel(t); timers.clear(); }
    state.moduleDone?.(rejected, value);
  };
  // JS exceptions thrown by browser APIs are caught in Wasm through JSTag.
  const engineTag = (globalThis as unknown as { WebAssembly: { JSTag?: unknown; Tag: new (d: unknown) => unknown } }).WebAssembly;
  host["jsTag"] = engineTag.JSTag ?? new engineTag.Tag({ parameters: ["externref"] });
  // Typed arrays: storage is freed when its owning $Bytes is collected.
  const registry = new (globalThis as unknown as { FinalizationRegistry: new (cb: (base: number) => void) => { register(target: object, held: number, token: object): void; unregister(token: object): boolean } })
    .FinalizationRegistry(base => state.bytesFree?.(base));
  // The web host finalizes the owner itself: no token (§7: a native host answers one and frees on its drop).
  host["bytes.track"] = (owner: object, base: number) => { registry.register(owner, base, owner); return null; };
  // A retained FFI span: the callee keeps the pointer, so the storage is never freed.
  host["bytes.pin"] = (owner: object) => { registry.unregister(owner); };
  const kinds = [Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array];
  // Engine views over the module memory. A resizable buffer keeps views
  // valid across memory.grow; each compiled array maps to one view (identity)
  // and the view keeps its compiled owner alive.
  let rbuf: ArrayBuffer | undefined;
  const memBuffer = (end = 0): ArrayBuffer => {
    const mem = state.memory as unknown as { buffer: ArrayBuffer; toResizableBuffer?: () => ArrayBuffer };
    // A shared memory's buffer never detaches; a newer one covers growth.
    if (isShared(mem.buffer)) return rbuf && rbuf.byteLength >= end ? rbuf : (rbuf = mem.buffer);
    // A fixed memory never grows: its own buffer never detaches.
    if (state.fixedMemory) return mem.buffer;
    // Instantiation refused hosts without toResizableBuffer (see instantiateLinked).
    if (!rbuf) rbuf = mem.toResizableBuffer!();
    return rbuf;
  };
  const views = new WeakMap<object, ArrayBufferView>(), viewOwners = new WeakMap<object, object>(), viewOffsets = new WeakMap<object, number>();
  // A typed array's `.buffer`, one per storage owner (identity: x.buffer === x.buffer).
  const buffers = new WeakMap<object, object>();
  host["bytes.bufferOf"] = (owner: object) => buffers.get(owner) ?? null;
  host["bytes.keepBuffer"] = (owner: object, buffer: object) => { buffers.set(owner, buffer); };
  /** The module memory covering [base, base + bytes), and base as the address it is (address.ts). */
  const span = (base: number, bytes: number): { buffer: ArrayBuffer; start: number } => {
    const buffer = memBuffer(moduleAddress(base) + bytes);
    return { buffer, start: memorySpan(base, bytes, buffer.byteLength).start };
  };
  host["bytes.toJs"] = (owner: object, kind: number, base: number, len: number) => {
    let v = views.get(owner) as (ArrayBufferView & { buffer: ArrayBuffer }) | undefined;
    // A fixed-memory fallback view detaches on growth: rebuild it.
    if (!v || v.buffer.byteLength === 0) {
      const at = span(base, len * kinds[kind]!.BYTES_PER_ELEMENT);
      v = new (kinds[kind]!)(at.buffer, at.start, len) as unknown as ArrayBufferView & { buffer: ArrayBuffer };
      views.set(owner, v);
      viewOwners.set(v, owner);
    }
    return v;
  };
  // Our own view unwraps only as its own element kind (checked boundary:
  // a Uint16Array is never reinterpreted as a Uint8Array).
  // The page sees a view's byteOffset/buffer as module memory (the accepted wasm-memory byte ABI);
  // compiled code reading byteOffset dynamically gets the JS one: 0, or a subarray's offset.
  host["bytes.viewOffset"] = (v: object, offset: number) => { viewOffsets.set(v, offset); };
  /** A property read by compiled code (js.get): our own view's byteOffset is its JS one. */
  const pageGet = (o: any, k: any): any => (k === "byteOffset" && viewOwners.has(o) ? viewOffsets.get(o) ?? 0 : o[K(k)]);
  host["bytes.unwrap"] = (v: unknown, kind: number) => {
    const owner = v !== null && typeof v === "object" ? viewOwners.get(v) : undefined;
    if (!owner) return null;
    if (viewKind(v) !== kinds[kind]!.name) throw new TypeError(`expected a ${kinds[kind]!.name}, got ${(v as object).constructor?.name}`);
    return owner;
  };
  /** A union's typed-array arm: exactly this element kind (never a reinterpretation), from any realm. */
  host["bytes.isKind"] = (v: unknown, kind: number) => (viewKind(v) === kinds[kind]!.name ? 1 : 0);
  // A view handed to a page position that admits only ArrayBuffer-backed views (WebIDL BufferSource without
  // [AllowShared]: Blob parts, TextDecoder.decode, a DecompressionStream write): over a shared memory the page gets a
  // copy of exactly the view's range in a buffer of its own, as the same kind of view; otherwise the view itself.
  const unsharedView = (v: unknown): unknown => (ArrayBuffer.isView(v) && isShared(v.buffer) ? copyView(v) : v);
  // An array of views (`new Blob(chunks)`): the array is the page's own (just marshaled), its shared views copied.
  host["bytes.unshared"] = (v: unknown) => (Array.isArray(v) ? v.map(unsharedView) : unsharedView(v));
  host["bytes.lengthOf"] = (v: unknown, kind: number) => {
    if (viewKind(v) !== kinds[kind]!.name) throw new TypeError(`expected a ${kinds[kind]!.name}, got ${v === null ? "null" : typeof v === "object" ? (v as object).constructor?.name : typeof v}`);
    return (v as { length: number }).length;
  };
  // A compiled promise's page Promise, made once: it unwraps back to the compiled promise.
  const promisePages = new WeakMap<object, object>();
  host["js.promisePage"] = (struct: object) => promisePages.get(struct) ?? null;
  host["js.keepPromisePage"] = (struct: object, page: object) => { promisePages.set(struct, page); FacadeBrand.stamp(page, struct); };
  // A page ArrayBuffer copied in at the crossing (the module's bytesAdoptPage export allocates, then copies here).
  host["bytes.pageLength"] = (b: ArrayBuffer) => b.byteLength;
  host["bytes.copyInPage"] = (b: ArrayBuffer, base: number) => {
    const at = span(base, b.byteLength);
    new Uint8Array(at.buffer, at.start, b.byteLength).set(new Uint8Array(b));
  };
  // `new Uint32Array(pageView)` (a page typed array held untyped: glTF accessor data): its element count, or -1 for
  // anything else (a DataView, a non-view); then its elements written in one TypedArray set, converting each by the
  // destination's kind, instead of an iterator step per element.
  host["bytes.viewLength"] = (v: unknown) => (viewKind(v) !== undefined ? (v as unknown as { length: number }).length : -1);
  host["bytes.setFrom"] = (v: ArrayLike<number>, kind: number, base: number, len: number) => {
    const Ctor = kinds[kind]!;
    const at = span(base, len * Ctor.BYTES_PER_ELEMENT);
    new Ctor(at.buffer, at.start, len).set(v);
  };
  // text.utf8(base, n, ignoreBOM): a whole buffer's UTF-8 as one string (TextDecoder, non-fatal: WHATWG replacement),
  // instead of the module's decoder building it a code point at a time. A shared memory's view is copied first
  // (TextDecoder refuses shared buffers). The native host has no such import: its builds keep the module's decoder.
  const utf8Decoders: { decode(v: Uint8Array): string }[] = [];
  host["text.utf8"] = (base: number, n: number, ignoreBOM: number) => {
    const at = span(base, n);
    const view = new Uint8Array(at.buffer, at.start, n);
    const decoder = utf8Decoders[ignoreBOM ? 1 : 0] ??= new TextDecoder("utf-8", { ignoreBOM: !!ignoreBOM });
    return decoder.decode(isShared(at.buffer) ? view.slice() : view);
  };
  host["bytes.copyIn"] = (v: ArrayBufferView, base: number, shift: number) => {
    // A multiply, not `<<`: a byte length past 2 GiB must not wrap negative either.
    const bytes = (v as unknown as { length: number }).length * 2 ** shift;
    const at = span(base, bytes);
    new Uint8Array(at.buffer, at.start, bytes).set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  };
  host["print.bytes"] = (kind: number, base: number, len: number) => {
    const Ctor = kinds[kind]!;
    const bytes = len * Ctor.BYTES_PER_ELEMENT;
    const buffer = state.memory!.buffer as ArrayBuffer;
    const start = memorySpan(base, bytes, buffer.byteLength).start;
    // A copy (slice), also for a shared memory: printing snapshots.
    pending.push(new Ctor(new Uint8Array(buffer, start, bytes).slice().buffer));
  };
  const typedFns = new WeakMap<object, Function>();
  /** The compiled closure behind a js.fromFn wrapper (js.unwrapFn answers it: `new` on the wrapper constructs compiled-side). */
  const typedFnClosures = new WeakMap<object, object>();
  // The page's engine as the dynamic island: jsval is externref and each
  // island operation is one of these (strict exits, JS-exact operators).
  const strict = (want: string) => (v: unknown) => {
    if (typeof v !== want) throw new TypeError(`expected ${want}, got ${v === null ? "null" : typeof v}`);
    return want === "boolean" ? (v ? 1 : 0) : v;
  };
  Object.assign(host, {
    "js.add": (a: any, b: any) => a + b, "js.sub": (a: any, b: any) => a - b, "js.mul": (a: any, b: any) => a * b,
    "js.div": (a: any, b: any) => a / b, "js.mod": (a: any, b: any) => a % b, "js.pow": (a: any, b: any) => a ** b,
    "js.neg": (a: any) => -a, "js.plus": (a: any) => +a,
    "js.lt": (a: any, b: any) => (a < b ? 1 : 0), "js.le": (a: any, b: any) => (a <= b ? 1 : 0), "js.gt": (a: any, b: any) => (a > b ? 1 : 0),
    "js.ge": (a: any, b: any) => (a >= b ? 1 : 0), "js.eq": (a: any, b: any) => (a === b ? 1 : 0), "js.neq": (a: any, b: any) => (a !== b ? 1 : 0),
    "js.instanceOf": (a: any, b: any) => (a instanceof b ? 1 : 0),
    "js.truthy": (a: any) => (a ? 1 : 0), "js.isNullish": (a: unknown) => (a == null ? 1 : 0), "js.undefined": () => undefined, "js.not": (a: any) => (a ? 0 : 1), "js.typeof": (a: any) => typeof a, "js.typeof.member": (o: any, k: string) => typeof o[k], "js.toStr": strict("string"),
    "js.global": (name: string) => (globalThis as any)[name],
    "js.get": (o: any, k: any) => pageGet(o, k), "js.set": (o: any, k: any, v: any) => { o[K(k)] = v; },
    "js.symbolKey": (s: symbol) => symbolKey(s), "js.symbolOf": (k: string) => K(k),
    "js.callSpread": (f: any, pre: any[], spread: any, spelling: string) => f(...spreadArguments(pre, spread, spelling)),
    // A method read off a page object that a typed record stands for: bound to the object, so the typed call reaches it with the right `this`.
    "js.getMethod": (o: any, k: any) => { const f = pageGet(o, k); return typeof f === "function" ? f.bind(o) : f; },
    // A page value that is plain data (a plain object): a union's record arm checks and copies it; anything else stays a page-backed record.
    // Plain data that a JSON copy carries faithfully: plain objects, arrays and primitives all the way down. A typed array,
    // buffer, Date, Map or any other object inside (a decode worker's reply carrying its pixels) is not: such a value
    // is read from the page as it is used instead.
    "js.isPlainData": (v: any) => { if (v === null || typeof v !== "object") return 0; const p = Object.getPrototypeOf(v); return (p === Object.prototype || p === null) && jsonFaithful(v, new Set()) ? 1 : 0; },
    "js.callMethodSpread": (recv: any, name: string, pre: any[], spread: any, spelling: string) => recv[name](...spreadArguments(pre, spread, spelling)),
    "js.fromNum": (x: number) => x, "js.fromBool": (b: number) => b !== 0, "js.null": () => null,
    "js.toNum": strict("number"), "js.toBool": strict("boolean"),
    "js.parse": (text: string) => JSON.parse(text), "js.stringify": (v: unknown) => JSON.stringify(v),
    // Our facades print as plain snapshots (see print.dyn); page values as themselves.
    "print.jsval": (v: unknown) => { pending.push(snapshotForPrint(v, new Map())); },
    // A native compiled value printed by the page console: our live facades
    // become plain snapshots (a console inspecting a Proxy would show its
    // empty target). Cycles, null prototypes, hidden properties and accessors
    // keep their shape.
    "print.dyn": (v: unknown) => { pending.push(snapshotForPrint(v, new Map())); },
    // A compiled closure as a JS function: the exported invoker checks arguments and runs it.
    // One wrapper per closure (function identity, e.g. removeEventListener).
    "js.fromFn": (closure: object, invoker: string) => {
      let f = typedFns.get(closure);
      if (!f) {
        const run = state.exports![invoker] as (c: unknown, ...a: unknown[]) => unknown;
        f = (...args: unknown[]) => run(closure, ...args);
        typedFns.set(closure, f);
        typedFnClosures.set(f, closure);
      }
      return f;
    },
    // A page thenable adopted by a compiled promise (checked payload): 0 when not a thenable.
    "js.bridgePromiseDyn": (p: any, target: unknown, check: number) => {
      if (p === null || (typeof p !== "object" && typeof p !== "function") || typeof p.then !== "function") return 0;
      const settle = (v: unknown, rejected: number) => { (state.exports!["jsSettleDyn"] as (t: unknown, v: unknown, r: number, c: number) => void)(target, v, rejected, check); };
      Promise.resolve(p).then(v => settle(v, 0), e => settle(e, 1));
      return 1;
    },
    "js.bridgePromise": (p: any, target: unknown) => {
      const settle = (v: unknown, rejected: number) => { (state.exports!["jsSettle"] as (t: unknown, v: unknown, r: number) => void)(target, v, rejected); };
      Promise.resolve(p).then(v => settle(v, 0), e => settle(e, 1));
    },
  });
  // Engine-backed dyn (browser builds compiling untyped JS): dyn values are
  // engine values; these are the checked-dynamic operations over them.
  const toNumeric = (v: any) => (typeof v === "bigint" ? v : +v);
  const wrapped = new WeakMap<Function, object>(), legacyFns = new WeakMap<object, Function>();
  // A page wrapper with the compiled function's JS name and length (an
  // anonymous function argument starts with name "" and length 0).
  // Only an ordinary function (flags bit 1) is a constructor with a
  // `prototype`; arrows and methods get a method wrapper (this, no prototype).
  /** The receiver a class wrapper passes for `new` (a construction, not a call). */
  const CONSTRUCT = Symbol("construct");
  const pageWrapper = (name: string, length: number, flags: number, run: (t: unknown, a: unknown[]) => unknown): Function => {
    // A class value (flags & 4): `new` constructs through the compiled class
    // (run with the construction marker); a call throws the class's TypeError.
    const f: Function = flags & 4 ? function (this: unknown, ...args: unknown[]) { return run(new.target === undefined ? this : CONSTRUCT, args); }
      : flags & 1 ? function (this: unknown, ...args: unknown[]) { return run(this, args); }
      : ({ m(this: unknown, ...args: unknown[]) { return run(this, args); } }).m;
    Object.defineProperty(f, "name", { value: name, configurable: true });
    if (length !== 0) Object.defineProperty(f, "length", { value: length, configurable: true });
    return f;
  };
  const BUILTIN_ERRORS = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError"]);
  // A compiled generator's page facade inherits %IteratorPrototype% (Symbol.iterator answers the iterator itself).
  const generatorFacadeProto = Object.create(Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())), { [Symbol.toStringTag]: { value: "Generator" } });
  const facades = new WeakMap<object, object>(), facadeStructs = new WeakMap<object, object>(), errorObjects = new WeakMap<object, Error>(), errorStructs = new WeakMap<object, object>();
  const snapshotForPrint = (v: any, seen: Map<object, unknown>): unknown => {
    // A compiled promise's page Promise prints as the Promise it is.
    if (v === null || typeof v !== "object" || !isFacade(v) || v instanceof Promise) return v;
    if (seen.has(v)) return seen.get(v);
    const proto = Object.getPrototypeOf(v);
    const copy: any = Array.isArray(v) ? [] : proto === null ? Object.create(null) : classProtoSet.has(proto) ? Object.create(proto) : {};
    seen.set(v, copy);
    for (const k of Reflect.ownKeys(v)) {
      if (Array.isArray(copy) && k === "length") continue;
      const d = Reflect.getOwnPropertyDescriptor(v, k)!;
      Object.defineProperty(copy, k, "value" in d ? { value: snapshotForPrint(d.value, seen), writable: true, enumerable: !!d.enumerable, configurable: true }
        : { get: d.get, set: d.set, enumerable: !!d.enumerable, configurable: true } as PropertyDescriptor);
    }
    if (Array.isArray(copy)) copy.length = v.length;
    return copy;
  };
  const isFacade = (v: object): boolean => FacadeBrand.structOf(v) !== undefined || facadeStructs.has(v);
  // The traps of every native-dyn facade of one kind (0 object, 1 array):
  // built on first use, when the module's dynFacade* exports exist. Each trap
  // reads its facade's compiled reference (and the Proxy itself) from the
  // target it is handed.
  let dynHandlers: [ProxyHandler<object>, ProxyHandler<object>] | undefined;
  /* Page-side integrity of a compiled array's facade (Object.preventExtensions / seal / freeze through the Proxy). The compiled array keeps one
   * level (none, sealed, frozen); the facade's target mirrors it so the Proxy invariants hold. Object.freeze arrives as preventExtensions, then a
   * {configurable:false, writable:false} definition per index, then length: preventExtensions mirrors the elements onto the target and the
   * definitions are collected; the length definition completes the sequence and applies the level to the compiled array. */
  interface ArrayOps { level(): number; apply(level: 1 | 2): void; present(): number[]; len(): number; get(i: number): unknown; set(i: number, v: unknown): void; setLen(n: number): void; canSeal: boolean }
  const arrayPending = new WeakMap<object, { c: Set<number>; w: Set<number> }>();
  const mirrorArray = (t: object, ops: ArrayOps, lv: number): void => {
    for (const i of ops.present()) Reflect.defineProperty(t, String(i), { value: ops.get(i), writable: lv < 2, enumerable: true, configurable: lv === 0 });
    Reflect.defineProperty(t, "length", { value: ops.len(), writable: lv < 2 });
    Reflect.preventExtensions(t);
  };
  /** A compiled array that took an integrity level (from compiled code, or the page's sequence) is non-extensible on the target too. */
  const syncArray = (t: object, ops: ArrayOps): void => { if (Reflect.isExtensible(t)) { const lv = ops.level(); if (lv > 0) mirrorArray(t, ops, lv); } };
  const arrayPreventExtensions = (t: object, ops: ArrayOps): boolean => {
    syncArray(t, ops);
    if (!Reflect.isExtensible(t)) return true;
    mirrorArray(t, ops, 0);
    arrayPending.set(t, { c: new Set(), w: new Set() });
    return true;
  };
  const arrayIndexOf = (k: string): number => (String(+k >>> 0) === k && +k < 4294967295 ? +k : -1);
  /** defineProperty on a non-extensible array target (the sequences of Object.seal / Object.freeze). */
  const arrayDefineLocked = (t: object, k: string, d: PropertyDescriptor, ops: ArrayOps): boolean => {
    const isLen = k === "length", i = isLen ? -1 : arrayIndexOf(k);
    if (!isLen && i < 0) return Reflect.defineProperty(t, k, d);
    if ("get" in d || "set" in d || d.enumerable === false) return false;
    if (ops.level() > 0) return Reflect.defineProperty(t, k, d);
    const pend = arrayPending.get(t);
    if (pend === undefined) return false;
    if (!isLen && !ops.present().includes(i)) return false;
    const wantC = d.configurable === false, wantW = d.writable === false;
    if ("value" in d) { if (isLen) ops.setLen(d.value as number); else ops.set(i, d.value); }
    if (!wantC) return !wantW && Reflect.defineProperty(t, k, { value: isLen ? ops.len() : ops.get(i), writable: true, enumerable: true, configurable: true });
    Reflect.defineProperty(t, k, { value: isLen ? ops.len() : ops.get(i), writable: !wantW, ...(isLen ? {} : { enumerable: true }), configurable: false });
    const key = isLen ? -1 : i;
    pend.c.add(key);
    if (wantW) pend.w.add(key);
    if (isLen) {
      const idx = ops.present();
      if (wantW && idx.every((j) => pend.w.has(j))) ops.apply(2);
      else if (!wantW && idx.every((j) => pend.c.has(j))) {
        if (!ops.canSeal) throw new TypeError("a compiled typed array cannot be sealed by JavaScript (freeze it instead)");
        ops.apply(1);
      } else return false;
      mirrorArray(t, ops, ops.level());
    }
    return true;
  };
  /** The descriptor of an index or length on an array facade: the integrity level, or the mirrored state of a prevented (not yet sealed) target. */
  const arrayDescriptor = (t: object, k: string, value: unknown, ops: ArrayOps): PropertyDescriptor => {
    syncArray(t, ops);
    const lv = ops.level(), enumerable = k !== "length";
    if (!Reflect.isExtensible(t)) {
      const m = Reflect.getOwnPropertyDescriptor(t, k);
      if (m) return { value, writable: lv > 0 ? lv < 2 : m.writable === true, enumerable, configurable: lv > 0 ? false : m.configurable === true };
    }
    return { value, writable: true, enumerable, configurable: k !== "length" };
  };
  /** A native-dyn facade: a target carrying the compiled reference, its Proxy and the brand. */
  const makeDynFacade = (ref: object, kind: number): object => {
    const handlers = dynHandlers ??= [dynFacadeHandler(false), dynFacadeHandler(true)];
    const isArr = kind === 1;
    const t = DynTarget.make(isArr ? [] : undefined, ref);
    const p = new Proxy(t, handlers[isArr ? 1 : 0]!);
    DynTarget.setProxy(t, p);
    FacadeBrand.stamp(p, ref);
    return p;
  };
  /** (compiled reference, facade) pairs js.setFacade has issued and not yet returned. */
  const facadeFlight: object[] = [];
  const dynFacadeHandler = (isArr: boolean): ProxyHandler<object> => {
    const x = state.exports! as any;
    // A symbol key is a compiled object's own key under its reserved name (symbolKey): one home for it.
    // An array keeps symbol keys on its facade's target (a compiled array has no named properties).
    // A string key goes in key form too (keyForm), so it never reads a symbol's slot.
    const key = (k: string | symbol): string | null => (typeof k === "symbol" && isArr ? null : keyForm(k));
    // Flag bits from dynFacadeAttrs: 1 read-only, 2 hidden, 4 non-configurable.
    const descOf = (ref: object, s: string, a: number): PropertyDescriptor => (a & 8)
      ? { get: x.dynFacadeAccessor(ref, s, 0) ?? undefined, set: x.dynFacadeAccessor(ref, s, 1) ?? undefined, enumerable: (a & 2) === 0, configurable: (a & 4) === 0 }
      : { value: x.dynFacadeGet(ref, s), writable: (a & 1) === 0, enumerable: (a & 2) === 0, configurable: (a & 4) === 0 };
    // Proxy invariants: a property reported non-configurable must exist so
    // on the target; mirror it there (it cannot be deleted natively either).
    // Mirrors land on the target under the real key (a reserved symbol name back to its symbol).
    const mirror = (t: object, s: string | symbol, d: PropertyDescriptor) => { if (d.configurable === false) Reflect.defineProperty(t, typeof s === "string" ? K(s) : s, d); };
    // A compiled object that is no longer extensible: its target holds every
    // own key with its descriptor and is not extensible either (the Proxy
    // invariants of a non-extensible target). Modules without the integrity
    // exports keep refusing.
    const syncSealed = (t: object, ref: object) => {
      // (dynFacadeOwnKeys answers the keys as the page sees them; the exports take them in key form.)
      for (const k of x.dynFacadeOwnKeys(ref) as string[]) { const s = keyForm(k), a = x.dynFacadeAttrs(ref, s) as number; if (a >= 0) Reflect.defineProperty(t, k, descOf(ref, s, a)); }
      // A non-extensible target's prototype can no longer change, and getPrototypeOf must answer exactly it: give it the compiled object's own.
      Reflect.setPrototypeOf(t, x.dynFacadeProto(ref) as object | null);
      Reflect.preventExtensions(t);
    };
    const dynArrayOps = (t: object): ArrayOps => {
      const ref = DynTarget.ref(t);
      return {
        level: () => (x.dynFacadeLevel ? x.dynFacadeLevel(ref) as number : 0), apply: (l) => { x.dynFacadeIntegrity(ref, l); },
        present: () => (Array.from(x.dynFacadeOwnKeys(ref) as string[]).filter((k) => arrayIndexOf(k) >= 0).map(Number)),
        len: () => x.dynFacadeGet(ref, "length") as number, get: (i) => x.dynFacadeGet(ref, String(i)), set: (i, v) => { x.dynFacadeSet(ref, String(i), v); },
        setLen: (n) => { x.dynFacadeSet(ref, "length", n); }, canSeal: true,
      };
    };
    const extensibleNow = (t: object): boolean => {
      if (isArr && x.dynFacadeLevel) syncArray(t, dynArrayOps(t));
      if (!Reflect.isExtensible(t)) return false;
      const ref = DynTarget.ref(t);
      if (isArr || !x.dynFacadeExtensible || x.dynFacadeExtensible(ref) !== 0) return true;
      syncSealed(t, ref);
      return false;
    };
    const protoNow = (ref: object) => x.dynFacadeProto(ref) as object | null;
    return {
      get: (t, k, recv) => {
        const ref = DynTarget.ref(t), s = key(k);
        if (s !== null && x.dynFacadeHas(ref, s)) {
          // A foreign receiver (Reflect.get(o, k, r)): an accessor's getter runs with it as `this`.
          if (recv !== DynTarget.proxy(t)) {
            const a = x.dynFacadeAttrs(ref, s) as number;
            if (a >= 0 && (a & 8)) { const g = x.dynFacadeAccessor(ref, s, 0); return g ? Reflect.apply(g, recv, []) : undefined; }
          }
          return x.dynFacadeGet(ref, s);
        }
        if (typeof k === "symbol" && Reflect.has(t, k)) return Reflect.get(t, k, recv);
        const pr = protoNow(ref);
        return pr === null ? undefined : Reflect.get(pr, k, recv);
      },
      set: (t, k, v, recv) => {
        const s = key(k);
        if (s === null) return Reflect.set(t, k, v, recv);
        const ref = DynTarget.ref(t);
        if (recv === DynTarget.proxy(t)) return x.dynFacadeSet(ref, s, v) !== 0;
        // A foreign receiver (Reflect.set(o, k, v, r)): ordinary set semantics
        // define the property on the receiver, unless ours is read-only.
        const a = x.dynFacadeAttrs(ref, s) as number;
        // An accessor: its setter runs with the receiver as `this` (none: the set fails).
        if (a >= 0 && (a & 8)) { const f = x.dynFacadeAccessor(ref, s, 1); if (!f) return false; Reflect.apply(f, recv, [v]); return true; }
        if (a >= 0 && (a & 1)) return false;
        if (recv === null || (typeof recv !== "object" && typeof recv !== "function")) return false;
        const ex = Reflect.getOwnPropertyDescriptor(recv, k);
        if (ex) return "value" in ex && ex.writable ? Reflect.defineProperty(recv, k, { value: v }) : false;
        return Reflect.defineProperty(recv, k, { value: v, writable: true, enumerable: true, configurable: true });
      },
      has: (t, k) => {
        const ref = DynTarget.ref(t), s = key(k);
        if (s !== null && x.dynFacadeHas(ref, s) !== 0) return true;
        if (typeof k === "symbol" && Reflect.has(t, k)) return true;
        const pr = protoNow(ref);
        return pr !== null && Reflect.has(pr, k);
      },
      deleteProperty: (t, k) => {
        const s = key(k);
        if (s === null) return Reflect.deleteProperty(t, k);
        if (x.dynFacadeDelete(DynTarget.ref(t), s) === 0) return false;
        if (!Reflect.isExtensible(t)) Reflect.deleteProperty(t, k);
        return true;
      },
      ownKeys: (t) => {
        const ks = Array.from(x.dynFacadeOwnKeys(DynTarget.ref(t)) as string[]);
        // A non-extensible target lists exactly the compiled keys (drop any deleted natively since).
        if (!extensibleNow(t)) for (const k of Reflect.ownKeys(t)) if (typeof k === "string" && !ks.includes(k)) Reflect.deleteProperty(t, k);
        const native = Array.from((x.dynFacadeOwnSymbols?.(DynTarget.ref(t)) ?? []) as string[]).map(K);
        const symbols = [...native, ...Reflect.ownKeys(t).filter(k => typeof k === "symbol" && !native.includes(k))];
        if (!isArr) return [...ks, ...symbols];
        // An array: index keys, then length, then the named properties in creation order.
        const isIndex = (k: string) => /^(0|[1-9]\d*)$/.test(k) && Number(k) < 4294967295;
        return [...ks.filter(isIndex), "length", ...ks.filter(k => !isIndex(k)), ...symbols];
      },
      getOwnPropertyDescriptor: (t, k) => {
        const s = key(k);
        if (s === null) return Reflect.getOwnPropertyDescriptor(t, k);
        const ref = DynTarget.ref(t);
        // An array's length mirrors the target's non-configurable slot (Proxy invariant).
        if (isArr && s === "length") return x.dynFacadeLevel ? arrayDescriptor(t, s, x.dynFacadeGet(ref, s), dynArrayOps(t)) : { value: x.dynFacadeGet(ref, s), writable: true, enumerable: false, configurable: false };
        const a = x.dynFacadeAttrs(ref, s) as number;
        if (a < 0) return typeof k === "symbol" ? Reflect.getOwnPropertyDescriptor(t, k) : undefined;
        if (isArr && x.dynFacadeLevel && arrayIndexOf(s) >= 0) return arrayDescriptor(t, s, x.dynFacadeGet(ref, s), dynArrayOps(t));
        const d = descOf(ref, s, a);
        mirror(t, k, d);
        return d;
      },
      // Data properties with their attributes (ValidateAndApplyPropertyDescriptor
      // for the non-configurable rules); accessors are refused before any change.
      defineProperty: (t, k, d) => {
        const s = key(k);
        if (s === null) return Reflect.defineProperty(t, k, d);
        const ref = DynTarget.ref(t);
        const a = x.dynFacadeAttrs(ref, s) as number;
        if ("get" in d || "set" in d) {
          // Accessors: compiled objects only; a non-configurable property stays as it is.
          if (isArr || (a >= 0 && (a & 4))) return false;
          const present = ("get" in d ? 1 : 0) | ("set" in d ? 2 : 0) | ("enumerable" in d ? 4 : 0) | ("configurable" in d ? 8 : 0);
          const values = (d.enumerable ? 4 : 0) | (d.configurable ? 8 : 0);
          if (x.dynFacadeDefineAccessor(ref, s, d.get, d.set, present, values) === 0) return false;
          mirror(t, s, descOf(ref, s, x.dynFacadeAttrs(ref, s)));
          return true;
        }
        if (isArr && x.dynFacadeLevel && (!Reflect.isExtensible(t) || (x.dynFacadeLevel(ref) as number) > 0)) { syncArray(t, dynArrayOps(t)); return arrayDefineLocked(t, k as string, d, dynArrayOps(t)); }
        if (isArr) {
          // Array properties carry no attribute bits: plain writable, enumerable, configurable data only. A new
          // property takes the unspecified attributes as false, so it must state each as true; an existing one
          // keeps what it has (a stated false is refused).
          if (d.writable === false || d.enumerable === false || d.configurable === false) return false;
          if (a < 0 && s !== "length" && (d.writable !== true || d.enumerable !== true || d.configurable !== true)) return false;
          if ("value" in d) x.dynFacadeSet(ref, s, d.value);
          else if (a < 0 && s !== "length") x.dynFacadeSet(ref, s, undefined);
          return true;
        }
        if (a >= 0 && (a & 8)) {
          // An accessor becomes a data property (its setter is not called): it keeps
          // its enumerable and configurable bits; writable defaults to false.
          if (a & 4) return false;
          let g = (a & 6) | (d.writable ? 0 : 1);
          if ("enumerable" in d) g = d.enumerable ? g & ~2 : g | 2;
          if ("configurable" in d) g = d.configurable ? g & ~4 : g | 4;
          if (x.dynFacadeDefineValue(ref, s, d.value) === 0) return false;
          x.dynFacadeSetFlags(ref, s, g);
          mirror(t, s, descOf(ref, s, g));
          return true;
        }
        let f: number;
        if (a < 0) {
          f = (d.writable ? 0 : 1) | (d.enumerable ? 0 : 2) | (d.configurable ? 0 : 4);
        } else {
          if (a & 4) {
            if (d.configurable) return false;
            if ("enumerable" in d && !!d.enumerable !== ((a & 2) === 0)) return false;
            if (a & 1) {
              if (d.writable) return false;
              if ("value" in d && !Object.is(d.value, x.dynFacadeGet(ref, s))) return false;
            }
          }
          f = a;
          if ("writable" in d) f = d.writable ? f & ~1 : f | 1;
          if ("enumerable" in d) f = d.enumerable ? f & ~2 : f | 2;
          if ("configurable" in d) f = d.configurable ? f & ~4 : f | 4;
        }
        if ("value" in d || a < 0) {
          if (a >= 0) x.dynFacadeSetFlags(ref, s, a & ~1);
          if (x.dynFacadeSet(ref, s, d.value) === 0) return false;
        }
        x.dynFacadeSetFlags(ref, s, f);
        mirror(t, s, descOf(ref, s, f));
        return true;
      },
      getPrototypeOf: (t) => protoNow(DynTarget.ref(t)),
      // The compiled object becomes non-extensible first (compiled arrays and
      // modules without the export refuse before any change).
      preventExtensions: (t) => {
        if (isArr) return x.dynFacadeLevel !== undefined && arrayPreventExtensions(t, dynArrayOps(t));
        if (!Reflect.isExtensible(t)) return true;
        const ref = DynTarget.ref(t);
        if (!x.dynFacadeIntegrity || x.dynFacadeIntegrity(ref, 0) === 0) return false;
        syncSealed(t, ref);
        return true;
      },
      isExtensible: (t) => extensibleNow(t),
    };
  };
  const isArrayIndex = (k: string | symbol): boolean => typeof k === "string" && String(Number(k) >>> 0) === k && Number(k) < 4294967295;
  // The traps of every record facade of one shape (module accessors `${base}Get`
  // / `Set` / `Adopt`, field names in JS own-key order as `name:index`).
  const recordHandlers = new Map<string, ProxyHandler<object>>();
  const recordFacadeHandler = (base: string, names: string, tuple: number): ProxyHandler<object> => {
    const get = state.exports![`${base}Get`] as (s: object, i: number) => unknown;
    const set = state.exports![`${base}Set`] as (s: object, i: number, v: unknown) => void;
    // `name:index` entries in JS own-key order; the index addresses the record's canonical field list.
    // An accessor property is `name:a<get>.<set>` (a half may be empty): run with the facade as `this`.
    const accessors = new Map<string, { get?: number; set?: number }>();
    const entries: (readonly [string, number])[] = [];
    (names ? names.split(",") : []).forEach((e, i) => {
      const at = e.lastIndexOf(":");
      if (at < 0) { entries.push([e, i]); return; }
      const tail = e.slice(at + 1);
      if (tail.startsWith("a")) {
        const [g, st] = tail.slice(1).split(".");
        accessors.set(e.slice(0, at), { ...(g ? { get: Number(g) } : {}), ...(st ? { set: Number(st) } : {}) });
        entries.push([e.slice(0, at), -1]);
        return;
      }
      entries.push([e.slice(0, at), Number(tail)]);
    });
    const keys = entries.map(([k]) => k), index = new Map(entries.filter(([k]) => !accessors.has(k))), keysHaveIndex = keys.some(isArrayIndex);
    const accessorFn = (t: object, k: string, half: "get" | "set"): ((this: unknown, ...a: unknown[]) => unknown) | undefined => {
      const i = accessors.get(k)?.[half];
      return i === undefined ? undefined : get(RecordTarget.struct(t), i) as (this: unknown, ...a: unknown[]) => unknown;
    };
    const adoptExport = state.exports![`${base}Adopt`] as ((s: object, o: object) => void) | undefined;
    // An open record (index signature or unsettable optional fields): its live own keys and any key's value come from the module.
    const keysExport = state.exports![`${base}Keys`] as ((s: object) => Iterable<string>) | undefined;
    const readExport = state.exports![`${base}Read`] as ((s: object, k: string) => unknown) | undefined;
    const liveKeys = (t: object): string[] => Array.from(keysExport!(RecordTarget.struct(t)));
    // Adopted: the fields now live on the target (the record's page
    // object), and every trap forwards to it — delete, freeze, seal and
    // descriptors then behave exactly as for any JS object.
    const adopt = (t: object) => {
      if (RecordTarget.adopted(t)) return;
      if (!adoptExport) throw new TypeError("this compiled value cannot be reshaped by JavaScript (delete, freeze or redefine)");
      const struct = RecordTarget.struct(t);
      // Properties the page added before this reshape follow the fields in
      // JS key order: move them behind the fields (a non-configurable one
      // cannot move and keeps its place).
      const added: [string | symbol, PropertyDescriptor][] = [];
      for (const k of Reflect.ownKeys(t)) {
        const d = Reflect.getOwnPropertyDescriptor(t, k)!;
        if (d.configurable) { added.push([k, d]); Reflect.deleteProperty(t, k); }
      }
      // An open record (undeclared keys kept from untyped data, an index signature): its live own keys in their order, extras read by name.
      if (keysExport !== undefined) {
        for (const k of liveKeys(t)) {
          const i = index.get(k);
          Reflect.defineProperty(t, k, { value: i !== undefined ? get(struct, i) : readExport!(struct, k), writable: true, enumerable: true, configurable: true });
        }
      } else for (const [k, i] of index) Reflect.defineProperty(t, k, { value: get(struct, i), writable: true, enumerable: true, configurable: true });
      for (const k of accessors.keys()) {
        const g = accessorFn(t, k, "get"), st = accessorFn(t, k, "set"), self = () => RecordTarget.proxy(t);
        Reflect.defineProperty(t, k, { ...(g ? { get: () => g.call(self()) } : {}), ...(st ? { set: (v: unknown) => { st.call(self(), v); } } : {}), enumerable: true, configurable: true } as PropertyDescriptor);
      }
      for (const [k, d] of added) Reflect.defineProperty(t, k, d);
      adoptExport(struct, RecordTarget.proxy(t)!);
      RecordTarget.setAdopted(t);
    };
    const field = (t: object, k: string | symbol) => (typeof k === "string" && !RecordTarget.adopted(t) ? index.get(k) : undefined);
    // A field holding undefined is ABSENT (the record model has no presence state beyond the value: ledger F013): it is not an own key.
    const present = (t: object, k: string): boolean => { const i = index.get(k); return tuple !== 0 || i === undefined || get(RecordTarget.struct(t), i) !== undefined; };
    return {
      get: (t, k, r) => {
        if (typeof k === "string" && accessors.has(k) && !RecordTarget.adopted(t)) return accessorFn(t, k, "get")?.call(r);
        const i = field(t, k); if (i !== undefined) return get(RecordTarget.struct(t), i);
        if (tuple && k === "length" && !RecordTarget.adopted(t)) return keys.length;
        if (readExport !== undefined && typeof k === "string" && !RecordTarget.adopted(t)) { const v = readExport(RecordTarget.struct(t), k); if (v !== undefined) return v; }
        return Reflect.get(t, k, r);
      },
      // A new string key reshapes the record: adopt first, so compiled code
      // (which reads an adopted record through this object) sees it too.
      set: (t, k, v, r) => {
        if (typeof k === "string" && accessors.has(k) && !RecordTarget.adopted(t)) { const fn = accessorFn(t, k, "set"); if (!fn) return false; fn.call(r, v); return true; }
        const i = field(t, k); if (i !== undefined) { set(RecordTarget.struct(t), i, v); return true; }
        if (typeof k === "string" && !RecordTarget.adopted(t) && !Object.prototype.hasOwnProperty.call(t, k)) adopt(t);
        return Reflect.set(t, k, v, r);
      },
      has: (t, k) => typeof k === "string" && accessors.has(k) && !RecordTarget.adopted(t) ? true : keysExport !== undefined && typeof k === "string" && !RecordTarget.adopted(t) ? liveKeys(t).includes(k) || Reflect.has(t, k) : (field(t, k) !== undefined && present(t, k as string)) || Reflect.has(t, k),
      // JS key order: array indices ascending, then strings by creation
      // (the fields, then what the page added), then symbols.
      ownKeys: (t) => {
        if (RecordTarget.adopted(t)) return Reflect.ownKeys(t);
        if (keysExport !== undefined) {
          const live = liveKeys(t), liveSet = new Set<string | symbol>(live);
          const extra = Reflect.ownKeys(t).filter((k) => !liveSet.has(k));
          const indices = [...live, ...extra].filter(isArrayIndex).sort((a, b) => Number(a) - Number(b));
          return [...indices, ...live.filter((k) => !isArrayIndex(k)), ...extra.filter((k) => !isArrayIndex(k as string))];
        }
        const added = Reflect.ownKeys(t).filter((k) => !index.has(k as string));
        const live = keys.filter((k) => present(t, k));
        if (!keysHaveIndex && !(added.length && isArrayIndex(added[0]!))) return [...live, ...added];
        const indices = [...live, ...added].filter(isArrayIndex).sort((a, b) => Number(a) - Number(b));
        return [...indices, ...live.filter((k) => !isArrayIndex(k)), ...added.filter((k) => !isArrayIndex(k))];
      },
      getOwnPropertyDescriptor: (t, k) => {
        if (typeof k === "string" && accessors.has(k) && !RecordTarget.adopted(t)) {
          const g = accessorFn(t, k, "get"), st = accessorFn(t, k, "set");
          return { ...(g ? { get: g } : {}), ...(st ? { set: st } : {}), enumerable: true, configurable: true } as PropertyDescriptor;
        }
        if (keysExport !== undefined && typeof k === "string" && !RecordTarget.adopted(t)) {
          if (!liveKeys(t).includes(k)) return Reflect.getOwnPropertyDescriptor(t, k);
          const i = index.get(k);
          return { value: i !== undefined ? get(RecordTarget.struct(t), i) : readExport!(RecordTarget.struct(t), k), writable: true, enumerable: true, configurable: true };
        }
        const i = field(t, k);
        if (i !== undefined) { const value = get(RecordTarget.struct(t), i); return value === undefined && !tuple ? undefined : { value, writable: true, enumerable: true, configurable: true }; }
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      deleteProperty: (t, k) => { if (field(t, k) !== undefined) adopt(t); return Reflect.deleteProperty(t, k); },
      defineProperty: (t, k, d) => { if (field(t, k) !== undefined || typeof k === "string" && !RecordTarget.adopted(t)) adopt(t); return Reflect.defineProperty(t, k, d); },
      preventExtensions: (t) => { adopt(t); return Reflect.preventExtensions(t); },
    };
  };
  // Class facades (js.classFacade): one parsed descriptor per concrete class
  // (its handler and prototype), one prototype per class level (the class
  // chain, each level carrying its own compiled methods and accessors).
  const classDescs = new Map<string, { proto: object; handler: ProxyHandler<object> }>();
  const classProtos = new Map<string, object>(), classProtoSet = new WeakSet<object>();
  const classMemberKey = (name: string): string | symbol => (name.startsWith("sym:") ? (Symbol as any)[name.slice(4)] : name);
  const classInstance = (self: unknown, cls: string, name: string): object => {
    const s = self !== null && (typeof self === "object" || typeof self === "function") ? FacadeBrand.structOf(self as object) : undefined;
    if (s === undefined) throw new TypeError(`Illegal invocation: ${cls}.prototype.${name} called on a value that is not a compiled ${cls}`);
    return s;
  };
  type ClassLevel = { b: string; n: string; m: [string, string, string][] };
  const classProto = (levels: ClassLevel[], at: number, errorBase = false): object => {
    if (at >= levels.length) return errorBase ? Error.prototype : Object.prototype;
    const level = levels[at]!;
    let proto = classProtos.get(level.b);
    if (proto) return proto;
    proto = Object.create(classProto(levels, at + 1, errorBase)) as object;
    const ex = state.exports as any, cls = level.n;
    const ctor = { [cls]: function () { throw new TypeError(`Class constructor ${cls} cannot be invoked from JavaScript (a compiled class)`); } }[cls]!;
    Object.defineProperty(ctor, "prototype", { value: proto, writable: false, enumerable: false, configurable: false });
    // The constructor stands for the compiled class only by name: its statics are not available to JavaScript (a read says so, never undefined).
    const ctorFacade = new Proxy(ctor, { get: (t, k, r) => (Reflect.has(t, k) ? Reflect.get(t, k, r) : (() => { throw new TypeError(`static member '${String(k)}' of the compiled class ${cls} is not available to JavaScript`); })()) });
    Object.defineProperty(proto, "constructor", { value: ctorFacade, writable: true, enumerable: false, configurable: true });
    const accessors = new Map<string, { get?: () => unknown; set?: (v: unknown) => void }>();
    for (const [kind, name, exp] of level.m) {
      const key = classMemberKey(name), label = typeof key === "symbol" ? `[${String(key.description)}]` : key;
      if (kind === "m") {
        const fn = { [label]: function (this: unknown, ...args: unknown[]) { return ex[exp](classInstance(this, cls, label), args); } }[label]!;
        Object.defineProperty(proto, key, { value: fn, writable: true, enumerable: false, configurable: true });
      } else if (kind === "x") {
        const fn = { [label]: function () { throw new TypeError(`${cls}.prototype.${label} is not available to JavaScript (the compiled class does not carry it)`); } }[label]!;
        Object.defineProperty(proto, key, { value: fn, writable: true, enumerable: false, configurable: true });
      } else {
        const acc = accessors.get(name) ?? {};
        if (kind === "g") acc.get = function (this: unknown) { return ex[exp](classInstance(this, cls, label)); };
        else acc.set = function (this: unknown, v: unknown) { ex[exp](classInstance(this, cls, label), v); };
        accessors.set(name, acc);
      }
    }
    for (const [name, acc] of accessors) Object.defineProperty(proto, classMemberKey(name), { get: acc.get, set: acc.set, enumerable: false, configurable: true } as PropertyDescriptor);
    classProtos.set(level.b, proto);
    classProtoSet.add(proto);
    return proto;
  };
  /** The facade traps of a tracked JavaScript class: its property bag (a dyn
   * facade, from `${base}Bag`) holds every created field's presence and order
   * and every other own property; field values stay in the struct. */
  const trackedClassHandler = (base: string, fields: string[], field: (k: string | symbol) => number | undefined, proto: object,
    refuse: (what: string, k: string | symbol) => never, cls: string): ProxyHandler<object> => {
    const ex = state.exports as any, get = ex[`${base}Get`] as (s: object, i: number) => unknown, set = ex[`${base}Set`] as (s: object, i: number, v: unknown) => void;
    const bagOf = ex[`${base}Bag`] as (s: object) => object | null;
    const bag = (t: object) => bagOf(RecordTarget.struct(t));
    const own = (b: object | null, k: string | symbol): b is object => b !== null && Object.prototype.hasOwnProperty.call(b, k);
    // Proxy invariant: a non-configurable property must exist so on the target.
    const mirror = (t: object, k: string | symbol, d: PropertyDescriptor | undefined) => { if (d && d.configurable === false) Reflect.defineProperty(t, k, d); return d; };
    return {
      get: (t, k, r) => { const i = field(k); if (i !== undefined) return get(RecordTarget.struct(t), i); const b = bag(t); return own(b, k) ? Reflect.get(b, k) : Reflect.get(t, k, r); },
      set: (t, k, v, r) => {
        const i = field(k);
        if (i !== undefined && r === RecordTarget.proxy(t)) { set(RecordTarget.struct(t), i, v); return true; }
        if (i !== undefined || r !== RecordTarget.proxy(t)) return Reflect.set(t, k, v, r);
        const b = bag(t);
        if (own(b, k)) return Reflect.set(b, k, v);
        // An accessor up the chain runs with this receiver.
        for (let o: object | null = proto; o; o = Object.getPrototypeOf(o)) {
          const d = Reflect.getOwnPropertyDescriptor(o, k);
          if (d) { if (d.set || d.get) return Reflect.set(t, k, v, r); break; }
        }
        return b !== null ? Reflect.set(b, k, v) : refuse("add", k);
      },
      has: (t, k) => field(k) !== undefined || own(bag(t), k) || Reflect.has(t, k),
      ownKeys: (t) => {
        const b = bag(t), keys: (string | symbol)[] = b === null ? [...fields] : Reflect.ownKeys(b);
        return [...keys, ...Reflect.ownKeys(t).filter((k) => !keys.includes(k))];
      },
      getOwnPropertyDescriptor: (t, k) => {
        const i = field(k), b = bag(t);
        if (i !== undefined) return b === null || own(b, k) ? { value: get(RecordTarget.struct(t), i), writable: true, enumerable: true, configurable: true } : undefined;
        return own(b, k) ? mirror(t, k, Reflect.getOwnPropertyDescriptor(b, k)) : Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty: (t, k, d) => {
        const i = field(k);
        if (i !== undefined) {
          if ("get" in d || "set" in d || d.writable === false || d.enumerable === false || d.configurable === false) return refuse("redefine", k);
          if ("value" in d) set(RecordTarget.struct(t), i, d.value);
          return true;
        }
        const b = bag(t);
        if (b === null || typeof k !== "string") return refuse("add", k);
        if (!Reflect.defineProperty(b, k, d)) return false;
        mirror(t, k, Reflect.getOwnPropertyDescriptor(b, k));
        return true;
      },
      deleteProperty: (t, k) => { if (field(k) !== undefined) return refuse("delete", k); const b = bag(t); return own(b, k) ? Reflect.deleteProperty(b, k) : Reflect.deleteProperty(t, k); },
      preventExtensions: () => { throw new TypeError(`Cannot freeze, seal or prevent extensions of a compiled ${cls} instance`); },
      setPrototypeOf: () => { throw new TypeError(`Cannot change the prototype of a compiled ${cls} instance`); },
    };
  };
  const classDesc = (desc: string) => {
    let d = classDescs.get(desc);
    if (d) return d;
    const parsed = JSON.parse(desc) as { b: string; f: string[]; l: ClassLevel[]; x?: 1; y?: 1; e?: 1 };
    const ex = state.exports as any, get = ex[`${parsed.b}Get`] as (s: object, i: number) => unknown, set = ex[`${parsed.b}Set`] as (s: object, i: number, v: unknown) => void;
    // A symbol-keyed field (`%symbol:<description>`) answers a symbol key with that description; string keys never reach it.
    const index = new Map(parsed.f.flatMap((name, i): [string, number][] => name.startsWith("%symbol:") ? [] : [[name, i]])), cls = parsed.l[0]?.n ?? "class";
    const symbolIndex = new Map(parsed.f.flatMap((name, i): [string, number][] => name.startsWith("%symbol:") ? [[name.slice(8), i]] : []));
    const field = (k: string | symbol) => (typeof k === "string" ? index.get(k) : symbolIndex.get(String(k)));
    const stringFields = parsed.f.filter(name => !name.startsWith("%symbol:"));
    const refuse = (what: string, k: string | symbol): never => { throw new TypeError(`Cannot ${what} property ${String(k)} of a compiled ${cls} instance (its shape is fixed)`); };
    const proto = classProto(parsed.l, 0, parsed.e === 1);
    if (parsed.x) {
      d = { proto, handler: trackedClassHandler(parsed.b, stringFields, field, proto, refuse, cls) };
      classDescs.set(desc, d);
      return d;
    }
    const handler: ProxyHandler<object> = {
      get: (t, k, r) => { const i = field(k); return i !== undefined ? get(RecordTarget.struct(t), i) : Reflect.get(t, k, r); },
      set: (t, k, v, r) => {
        const i = field(k);
        if (i !== undefined && r === RecordTarget.proxy(t)) { set(RecordTarget.struct(t), i, v); return true; }
        // An accessor up the chain runs with this receiver; a foreign
        // receiver gets the ordinary data-property result.
        if (i !== undefined || r !== RecordTarget.proxy(t)) return Reflect.set(t, k, v, r);
        for (let o: object | null = proto; o; o = Object.getPrototypeOf(o)) {
          const d = Reflect.getOwnPropertyDescriptor(o, k);
          if (d) { if (d.set) return Reflect.set(t, k, v, r); break; }
        }
        return refuse("add", k);
      },
      has: (t, k) => field(k) !== undefined || Reflect.has(t, k),
      ownKeys: (t) => [...stringFields, ...Reflect.ownKeys(t)],
      getOwnPropertyDescriptor: (t, k) => {
        const i = field(k);
        return i !== undefined ? { value: get(RecordTarget.struct(t), i), writable: true, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty: (t, k, d) => {
        const i = field(k);
        if (i === undefined || "get" in d || "set" in d || d.writable === false || d.enumerable === false || d.configurable === false) return refuse(i === undefined ? "add" : "redefine", k);
        if ("value" in d) set(RecordTarget.struct(t), i, d.value);
        return true;
      },
      deleteProperty: (t, k) => (field(k) !== undefined ? refuse("delete", k) : Reflect.deleteProperty(t, k)),
      preventExtensions: () => { throw new TypeError(`Cannot freeze, seal or prevent extensions of a compiled ${cls} instance`); },
      setPrototypeOf: () => { throw new TypeError(`Cannot change the prototype of a compiled ${cls} instance`); },
    };
    // A user Error subclass: stack, cause and every member the compiled fields lack come from the instance's Error twin (the module's errTwin).
    if (parsed.e === 1) {
      const plain = handler.get!;
      const twinOf = (t: object) => (state.exports as any).errTwin(RecordTarget.struct(t)) as Record<string | symbol, unknown>;
      handler.get = (t, k, r) => (field(k) === undefined && (k === "stack" || k === "cause" || k === "name" || k === "message") ? twinOf(t)[k] : plain(t, k, r));
      handler.has = (t, k) => field(k) !== undefined || k in twinOf(t) || Reflect.has(t, k);
      // Own-ness and enumerability of stack / message / name / cause / errors follow the instance's Error twin, which mirrors the
      // compiled presence flags (`message` is own once given, `name` own and enumerable only when the program assigned it).
      const special = (k: string | symbol): boolean => k === "stack" || k === "message" || k === "name" || k === "cause" || k === "errors";
      const keysPlain = handler.ownKeys!, descPlain = handler.getOwnPropertyDescriptor!;
      handler.ownKeys = (t) => {
        const tw = Reflect.ownKeys(twinOf(t));
        return [...["stack", "message"].filter((k) => tw.includes(k)), ...Array.from(keysPlain(t)).filter((k) => !special(k)), ...["name", "cause", "errors"].filter((k) => tw.includes(k))];
      };
      handler.getOwnPropertyDescriptor = (t, k) => {
        if (!special(k)) return descPlain(t, k);
        const td = Reflect.getOwnPropertyDescriptor(twinOf(t), k);
        if (td === undefined) return undefined;
        const i = typeof k === "string" ? field(k) : undefined;
        return i !== undefined ? { value: get(RecordTarget.struct(t), i), writable: true, enumerable: !!td.enumerable, configurable: true } : { ...td, configurable: true };
      };
    }
    // An untracked class with a property bag: keys added from compiled code live in the bag, after the declared fields.
    if (parsed.y) {
      const bagOf = (state.exports as any)[`${parsed.b}Bag`] as (s: object) => object | null;
      const bagFor = (t: object): object | null => bagOf(RecordTarget.struct(t));
      const ownIn = (b: object | null, k: string | symbol): b is object => b !== null && Object.prototype.hasOwnProperty.call(b, k);
      const { get: baseGet, has: baseHas, ownKeys: baseKeys, getOwnPropertyDescriptor: baseDesc, set: baseSet } = handler;
      handler.get = (t, k, r) => { if (field(k) === undefined) { const b = bagFor(t); if (ownIn(b, k)) return Reflect.get(b, k); } return baseGet!(t, k, r); };
      handler.has = (t, k) => ownIn(bagFor(t), k) || baseHas!(t, k);
      handler.ownKeys = (t) => { const keys = Array.from(baseKeys!(t)), b = bagFor(t); return b === null ? keys : [...keys, ...Reflect.ownKeys(b).filter((k) => !keys.includes(k))]; };
      handler.getOwnPropertyDescriptor = (t, k) => {
        if (field(k) === undefined) { const b = bagFor(t); if (ownIn(b, k)) return Reflect.getOwnPropertyDescriptor(b, k); }
        return baseDesc!(t, k);
      };
      // A key the page adds stays refused (the shape is fixed); only an existing bag entry takes a write.
      handler.set = (t, k, v, r) => {
        if (field(k) === undefined && r === RecordTarget.proxy(t)) { const b = bagFor(t); if (ownIn(b, k)) return Reflect.set(b, k, v); }
        return baseSet!(t, k, v, r);
      };
    }
    d = { proto, handler };
    classDescs.set(desc, d);
    return d;
  };
  const G = globalThis as any;
  const arrayIteration = pristineArrayIteration();
  // The engine's own Array.prototype members, captured at instantiation (only while they are native functions of the right name).
  const arrayMembers = new Map<string, Function>();
  for (const name of ["at", "with", "toReversed", "toSorted", "toSpliced", "findLast", "findLastIndex", "reduceRight", "flat", "flatMap", "copyWithin"]) {
    const d = Object.getOwnPropertyDescriptor(Array.prototype, name);
    if (d !== undefined && typeof d.value === "function" && Function.prototype.toString.call(d.value) === `function ${name}() { [native code] }`) arrayMembers.set(name, d.value);
  }
  // js.iterPristine(kind): 0 Array, 1 String, 2 Map, 3 Set: the page's iteration protocol of that kind is still the engine's own.
  const kindIteration = [() => (arrayIteration !== null && arrayIteration.pristine()), pristineProtocol("", String.prototype), pristineProtocol(new Map([[1, 2]]), Map.prototype), pristineProtocol(new Set([1]), Set.prototype)];
  const pageDelete = (o: any, k0: any, strict: number) => { const k = K(k0); if (!Reflect.deleteProperty(Object(o), k) && strict) throw new TypeError(`Cannot delete property '${String(k)}' of ${String(o)}`); };
  let enc: { t: unknown; f: unknown; n: unknown; num: (v: number) => unknown } | undefined;
  const encoding = () => {
    const ex = state.exports as Record<string, any> | undefined;
    if (!ex?.["dynFromNum"]) throw new Error("js.toDyn: the module's dyn encoding exports are missing");
    return enc = { t: ex["dynTrue"].value, f: ex["dynFalse"].value, n: ex["dynNullBox"].value, num: ex["dynFromNum"] };
  };
  // Our wrappers by typeof (js.unwrapAny's four registries, split): every
  // facade (FacadeBrand: record, class and dyn facades; facadeStructs: array
  // facades) is a Proxy over an object or array, every function wrapper
  // (ClosureBrand; `wrapped` in FNCACHE_LEGACY builds) a function, so a page
  // object or function pays two lookups, not four.
  // experimentalDomMirror (dom-mirror.ts): a node compiled code created is
  // stamped with its struct, which every entry into compiled code returns.
  let mirroring = false;
  const ourObject = (v: object): object | undefined => (mirroring ? NodeBrand.of(v) : undefined) ?? FacadeBrand.structOf(v) ?? facadeStructs.get(v);
  /** A page ArrayBuffer entering compiled code: copied in (the module's bytesAdoptPage). The module memory's own
   * buffer (shared, or resizable when not) is never one: compiled storage crosses out as views over it. */
  // Once per page buffer: every later crossing of the same page ArrayBuffer answers the same compiled buffer, so
  // views over it alias and `===` holds, as in JS.
  const adoptedBuffers = new WeakMap<ArrayBuffer, object>();
  const adoptPageBuffer = (v: object): object | undefined => {
    if (!(v instanceof ArrayBuffer) || (v as ArrayBuffer & { resizable?: boolean }).resizable === true) return undefined;
    const held = adoptedBuffers.get(v);
    if (held) return held;
    const adopt = state.exports?.["bytesAdoptPage"] as ((b: ArrayBuffer) => object) | undefined;
    if (!adopt) return undefined;
    const adopted = adopt(v);
    adoptedBuffers.set(v, adopted);
    return adopted;
  };
  /** The DOM's own creation methods of this realm (resolved once the page has a Document). */
  let domOwn: Record<string, Function> | null = null;
  const domRealm = (): Record<string, Function> | null => {
    if (domOwn) return domOwn;
    const W: any = typeof G.Document === "function" ? G : G.window;
    const D = W?.Document;
    if (typeof D !== "function" || typeof D.prototype?.createElement !== "function") return null;
    const N = W.Node?.prototype, El = W.Element?.prototype;
    return domOwn = { createElement: D.prototype.createElement, createTextNode: D.prototype.createTextNode, createComment: D.prototype.createComment,
      appendChild: N?.appendChild, insertBefore: N?.insertBefore, setAttribute: El?.setAttribute, removeAttribute: El?.removeAttribute };
  };
  /** `node.<method>(...args)` on a mirrored node: 1 when it was the DOM's own
   * method (the module keeps its facts), else 0 after the page's method ran
   * (its result waits in domResult). One Get, as the call expression does. */
  const domMutate = (method: string, node: any, argc: number, a: unknown, b?: unknown): number => {
    const f = node[method];
    if (f !== undefined && f === domRealm()?.[method]) { if (argc === 2) uncurryThis(f, node, a, b); else uncurryThis(f, node, a); return 1; }
    if (typeof f !== "function") throw new TypeError(`o.${method} is not a function`);
    domResult = argc === 2 ? uncurryThis(f, node, a, b) : uncurryThis(f, node, a);
    return 0;
  };
  /** Every property name a DOM node interface of this realm defines (each
   * global constructor whose prototype is Node.prototype or inherits from it,
   * up its chain, and Object.prototype's), collected once: any other string
   * key a compiled store puts on a mirrored node is an expando the module
   * keeps (dom-mirror.ts). Reads descriptors and prototypes only. */
  let domNames: Set<string> | null = null;
  const domExpandoKey = (k: unknown): number => {
    if (typeof k !== "string" || k === "" || (k.charCodeAt(0) >= 48 && k.charCodeAt(0) <= 57)) return 0;
    if (!domNames) {
      const W: any = typeof G.Document === "function" ? G : G.window;
      const nodeProto = W?.Node?.prototype;
      if (!nodeProto) return 0;
      const names = new Set<string>(Object.getOwnPropertyNames(Object.prototype));
      const isProto = Object.prototype.isPrototypeOf, protoOf = Object.getPrototypeOf, gopd = Object.getOwnPropertyDescriptor;
      for (const g of Object.getOwnPropertyNames(W)) {
        const d = gopd(W, g), ctor = d && "value" in d ? d.value : undefined;
        const proto = typeof ctor === "function" ? gopd(ctor, "prototype")?.value : undefined;
        if (proto === null || typeof proto !== "object" || (proto !== nodeProto && !uncurryThis(isProto, nodeProto, proto))) continue;
        for (let p = proto; p !== null && p !== Object.prototype; p = protoOf(p)) for (const n of Object.getOwnPropertyNames(p)) names.add(n);
      }
      domNames = names;
    }
    return domNames.has(k) ? 0 : 1;
  };
  /** A mirrored creation whose method was not the DOM's own: its result, for js.domm.result. */
  let domResult: unknown;
  const docIds = new Map<object, number>();
  let lastDoc: object | null = null;
  /** `doc.<method>(arg)` (one Get, then the call): through the DOM's own
   * method, the node stamped with the module's fresh struct `h`, else the
   * page's method with null returned (its result waits in domResult). */
  const domCreate = (method: string, doc: any, arg: unknown, h: object): unknown => {
    const f = doc[method], own = domRealm()?.[method];
    if (own !== undefined && f === own) {
      const n = uncurryThis(own, doc, arg) as object;
      NodeBrand.stamp(n, h);
      mirroring = true;
      if (doc !== lastDoc) {
        let id = docIds.get(doc);
        if (id === undefined) { id = docIds.size + 1; docIds.set(doc, id); }
        lastDoc = doc;
        (state.exports!["domDocId"] as { value: number }).value = id;
      }
      return n;
    }
    if (typeof f !== "function") throw new TypeError(`o.${method} is not a function`);
    domResult = uncurryThis(f, doc, arg);
    return null;
  };
  const ourFunction = (v: Function): object | undefined => ClosureBrand.closureOf(v) ?? wrapped.get(v);
  const toDyn = (v: any): unknown => {
    if (v === undefined) return null;
    switch (typeof v) {
      case "object": return v === null ? (enc ?? encoding()).n : ourObject(v) ?? adoptPageBuffer(v) ?? v;
      case "string": return v;
      case "function": return ourFunction(v) ?? v;
      case "number": return (v | 0) === v && v >= -0x40000000 && v <= 0x3fffffff && (v !== 0 || 1 / v > 0) ? v : (enc ?? encoding()).num(v);
      case "boolean": return v ? (enc ?? encoding()).t : (enc ?? encoding()).f;
      default: return v;
    }
  };
  // A compiled function's call from the page. A pre-classified invoker
  // (`@d`) takes this and the first four arguments in toDyn's encoding.
  const dynInvoker = (closure: object, invoker: string): ((t: unknown, a: unknown[]) => unknown) => {
    if (!invoker.endsWith("@d")) {
      const run = state.exports![invoker] as (c: unknown, t: unknown, a: unknown[]) => unknown;
      return (t, a) => run(closure, t, a);
    }
    const run = state.exports![invoker] as (c: unknown, t: unknown, n: number, a0: unknown, a1: unknown, a2: unknown, a3: unknown, a: unknown[]) => unknown;
    return (t, a) => {
      const n = a.length;
      // A construction (CONSTRUCT as this) passes the count as -1 - n, no receiver.
      return run(closure, t === CONSTRUCT ? null : toDyn(t), t === CONSTRUCT ? -1 - n : n, n > 0 ? toDyn(a[0]) : null, n > 1 ? toDyn(a[1]) : null, n > 2 ? toDyn(a[2]) : null, n > 3 ? toDyn(a[3]) : null, a);
    };
  };
  Object.assign(host, {
    "undefined": new (G.WebAssembly.Global)({ value: "externref", mutable: false }, undefined),
    "true": new (G.WebAssembly.Global)({ value: "externref", mutable: false }, true),
    "false": new (G.WebAssembly.Global)({ value: "externref", mutable: false }, false),
    "js.band": (a: any, b: any) => a & b, "js.bor": (a: any, b: any) => a | b, "js.bxor": (a: any, b: any) => a ^ b,
    "js.shl": (a: any, b: any) => a << b, "js.shr": (a: any, b: any) => a >> b, "js.ushr": (a: any, b: any) => a >>> b, "js.bnot": (a: any) => ~a,
    "js.toNumeric": toNumeric,
    "js.toNumberOr": (v: any, dflt: number) => (v === undefined ? dflt : Number(v)),
    "js.inc": (v: any, plus: number) => { const n: any = toNumeric(v); const one: any = typeof n === "bigint" ? 1n : 1; return plus ? n + one : n - one; },
    "js.reflectGet": (o: any, k: any, r: any) => Reflect.get(Object(o), K(k), r),
    "js.delete": pageDelete,
    // A run of consecutive deletes on one page object with stable keys
    // (React's detachDeletedInstance): one call, deleting in order; a strict
    // failure throws there, leaving the later keys in place, as the
    // statements would.
    "js.delete2": (o: any, strict: number, a: any, b: any) => { pageDelete(o, a, strict); pageDelete(o, b, strict); },
    "js.delete3": (o: any, strict: number, a: any, b: any, c: any) => { pageDelete(o, a, strict); pageDelete(o, b, strict); pageDelete(o, c, strict); },
    "js.delete4": (o: any, strict: number, a: any, b: any, c: any, d: any) => { pageDelete(o, a, strict); pageDelete(o, b, strict); pageDelete(o, c, strict); pageDelete(o, d, strict); },
    "js.delete5": (o: any, strict: number, a: any, b: any, c: any, d: any, e: any) => { pageDelete(o, a, strict); pageDelete(o, b, strict); pageDelete(o, c, strict); pageDelete(o, d, strict); pageDelete(o, e, strict); },
    "js.hasProp": (o: any, k: any) => (K(k) in o ? 1 : 0),
    "js.newSet": (v: any) => new Set(v),
    "js.construct": (C: any, args: any) => Reflect.construct(C, Array.from(args)),
    "js.keys": (o: any) => Object.keys(o),
    "js.forInKeys": (o: any) => { const keys: string[] = []; for (const k in o) keys.push(k); return keys; },
    "js.builtinMethod": (ctor: string, name: string) => G[ctor].prototype[K(name)],
    "js.defineProperty": (o: any, k: any, d: any) => Object.defineProperty(o, K(k), d),
    "js.getOwnPropertyDescriptor": (o: any, k: any) => Object.getOwnPropertyDescriptor(o, K(k)),
    "js.assign": (t: any, src: any) => Object.assign(t, src),
    // structuredClone: the page's own algorithm; `opts` (undefined when absent) is validated by it.
    // A compiled object's page facade is a Proxy, which the page's algorithm refuses: on a DataCloneError the
    // plain data under facades is read out (own enumerable properties, cycles kept) and cloned instead.
    "js.structuredClone": (v: any, opts: any) => {
      const clone = (x: any): any => (opts === undefined || opts === null ? structuredClone(x) : structuredClone(x, opts));
      try { return clone(v); } catch (e: any) {
        if (e?.name !== "DataCloneError") throw e;
        const seen = new Map<object, any>();
        const plain = (x: any): any => {
          if (x === null || typeof x !== "object") return x;
          if (seen.has(x)) return seen.get(x);
          // A view over the module's memory cannot be cloned (that buffer is not transferable): copy its elements out.
          if (ArrayBuffer.isView(x)) return x instanceof DataView ? new DataView(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)) : new (x.constructor as any)(x);
          if (x instanceof ArrayBuffer || x instanceof Date || x instanceof RegExp || x instanceof Map || x instanceof Set || x instanceof Error) return x;
          const out: any = Array.isArray(x) ? [] : {};
          seen.set(x, out);
          for (const k of Object.keys(x)) out[k] = plain(x[k]);
          return out;
        };
        return clone(plain(v));
      }
    },
    // The zero-argument call and the non-empty static transfer list: the page's own errors.
    "js.cloneView": (v: any) => new v.constructor(v),
    "js.cloneUnsupported": () => { structuredClone(() => undefined); },
    "js.cloneMissing": () => (structuredClone as (...args: unknown[]) => unknown)(),
    "js.cloneTransferFail": () => structuredClone(undefined, { transfer: [{} as unknown as ArrayBuffer] }),
    "js.assignAll": (t: any, srcs: any) => Object.assign(t, ...Array.from(srcs ?? [])),
    "js.looseEq": (a: any, b: any) => (a == b ? 1 : 0),
    "js.protoOf": (ctor: string) => G[ctor].prototype,
    "js.arrayFrom": (v: any) => Array.from(v),
    "js.literalProperty": (target: any, key: any, value: any) => { Object.defineProperty(target, key, {value, writable:true, configurable:true, enumerable:true}); },
    "js.spreadValues": (v: any) => [...v],
    "js.copyDataProperties": (target: any, source: any) => {
      if (source != null) for (const key of Reflect.ownKeys(Object(source))) {
        if (Object.getOwnPropertyDescriptor(source, key)?.enumerable) Object.defineProperty(target, key, { value: source[key], enumerable: true, configurable: true, writable: true });
      }
      return target;
    },
    // Array.prototype.join's element rule: null and undefined join as "".
    "js.joinPart": (v: any) => (v == null ? "" : String(v)),
    // JSON.stringify(value, replacer, indent): the frontend passes the indent
    // already normalised ("" for none); the result may be undefined.
    // Primitive wrapper objects (JSON.stringify's SerializeJSONProperty step 4): 0 none, 1 Number, 2 String, 3 Boolean (true), 4 BigInt,
    // 5 Boolean (false). Brand checks by the builtin valueOf, which throws for any other object; a native host has no such objects (0).
    "js.primitiveWrapperKind": (v: any): number => {
      if (v === null || typeof v !== "object") return 0;
      try { Number.prototype.valueOf.call(v); return 1; } catch { /* not a Number object */ }
      try { String.prototype.valueOf.call(v); return 2; } catch { /* not a String object */ }
      try { return Boolean.prototype.valueOf.call(v) ? 3 : 5; } catch { /* not a Boolean object */ }
      try { BigInt.prototype.valueOf.call(v); return 4; } catch { /* not a BigInt object */ }
      return 0;
    },
    "js.jsonStringifyAll": (v: any, replacer: any, space: any) => JSON.stringify(v, replacer, space),
    "js.jsonStringify": (v: any, replacer: any, indent: string) => JSON.stringify(v, replacer ?? undefined, indent === "" ? undefined : indent),
    // One-call page-value classification for $dyn.fromJs (native dyn):
    // 0 undefined, 1 number, 2 false, 3 true, 4 one of our wrappers, 5 other.
    "js.classify": (v: any) => (v === undefined ? 0 : typeof v === "number" ? 1 : v === false ? 2 : v === true ? 3
      : (typeof v === "object" ? v !== null && (ourObject(v) !== undefined || (v instanceof ArrayBuffer && (v as ArrayBuffer & { resizable?: boolean }).resizable !== true && state.exports?.["bytesAdoptPage"] !== undefined)) : typeof v === "function" && ourFunction(v) !== undefined) ? 4 : 5),
    // A host result in the encoding $dyn.fromJsD decodes without a host call
    // (`<name>@d<arity>` imports apply it to their result): undefined is the
    // null externref; a string, a symbol, a bigint, an integer V8 internalizes
    // as i31 (in [-2^30, 2^30), not -0) and a page object or function stay
    // themselves; null, booleans and every other number become compiled dyn
    // values (the module's exported singletons, dynFromNum's box); one of our
    // wrappers becomes its compiled value (as js.unwrapAny).
    "js.toDyn": toDyn,
    // experimentalDomMirror (dom-mirror.ts): the module decides when these run page code.
    "js.domm.create.createElement": (doc: any, arg: unknown, h: object) => domCreate("createElement", doc, arg, h),
    "js.domm.create.createTextNode": (doc: any, arg: unknown, h: object) => domCreate("createTextNode", doc, arg, h),
    "js.domm.create.createComment": (doc: any, arg: unknown, h: object) => domCreate("createComment", doc, arg, h),
    "js.domm.appendChild": (p: any, c: unknown) => domMutate("appendChild", p, 1, c),
    "js.domm.insertBefore": (p: any, c: unknown, r: unknown) => domMutate("insertBefore", p, 2, c, r),
    "js.domm.setAttribute": (p: any, k: unknown, v: unknown) => domMutate("setAttribute", p, 2, k, v),
    "js.domm.removeAttribute": (p: any, k: unknown) => domMutate("removeAttribute", p, 1, k),
    "js.domm.expandoKey": domExpandoKey,
    "js.domm.result": () => { const r = domResult; domResult = undefined; return r; },
    "js.domm.result@d0": () => { const r = domResult; domResult = undefined; return toDyn(r); },
    // The hottest pre-classified operations as their own functions: each
    // keeps its own type feedback (a shared synthesized wrapper would make
    // every call through it polymorphic), with toDyn inlined.
    "js.get@d2": (o: any, k: any) => toDyn(pageGet(o, k)),
    "js.arg@d2": (args: any[], i: number) => toDyn(args[i]),
    "js.builtinMethod@d2": (ctor: string, name: string) => toDyn(G[ctor].prototype[name]),
    // A structured-clone sink call (postMessage / pushState / replaceState): see callSink.
    "js.sinkMethod.1": (o: any, k: any, a: any) => callSink(o, k, [a]),
    "js.sinkMethod.2": (o: any, k: any, a: any, b: any) => callSink(o, k, [a, b]),
    "js.sinkMethod.3": (o: any, k: any, a: any, b: any, c: any) => callSink(o, k, [a, b, c]),
    "js.callMethod.0@d2": (o: any, k: any) => toDyn(o[k]()),
    "js.callMethod.1@d3": (o: any, k: any, a: any) => toDyn(o[k](a)),
    "js.callMethod.2@d4": (o: any, k: any, a: any, b: any) => toDyn(o[k](a, b)),
    "js.callMethod.3@d5": (o: any, k: any, a: any, b: any, c: any) => toDyn(o[k](a, b, c)),
    "js.callMethod.4@d6": (o: any, k: any, a: any, b: any, c: any, d: any) => toDyn(o[k](a, b, c, d)),
    // Common DOM members by name (DOM_DIRECT): each its own function, so
    // the member is a named access with its own feedback (V8's named-load
    // IC per member) instead of the generic keyed `o[k]` of js.get /
    // js.callMethod.N, which every page read and call shares and keeps
    // megamorphic. Each is exactly `o.<name>` / `o.<name>(...)` / a strict
    // `o.<name> = v` for any receiver, so an overridden method, an own
    // property, a getter or a non-DOM object behaves as with the generic
    // operation.
    "js.dom.appendChild.1": (o: any, a: any) => o.appendChild(a), "js.dom.appendChild.1@d2": (o: any, a: any) => toDyn(o.appendChild(a)),
    "js.dom.insertBefore.2": (o: any, a: any, b: any) => o.insertBefore(a, b), "js.dom.insertBefore.2@d3": (o: any, a: any, b: any) => toDyn(o.insertBefore(a, b)),
    "js.dom.removeChild.1": (o: any, a: any) => o.removeChild(a), "js.dom.removeChild.1@d2": (o: any, a: any) => toDyn(o.removeChild(a)),
    "js.dom.replaceChild.2": (o: any, a: any, b: any) => o.replaceChild(a, b), "js.dom.replaceChild.2@d3": (o: any, a: any, b: any) => toDyn(o.replaceChild(a, b)),
    "js.dom.setAttribute.2": (o: any, a: any, b: any) => o.setAttribute(a, b), "js.dom.setAttribute.2@d3": (o: any, a: any, b: any) => toDyn(o.setAttribute(a, b)),
    "js.dom.removeAttribute.1": (o: any, a: any) => o.removeAttribute(a), "js.dom.removeAttribute.1@d2": (o: any, a: any) => toDyn(o.removeAttribute(a)),
    "js.dom.setAttributeNS.3": (o: any, a: any, b: any, c: any) => o.setAttributeNS(a, b, c), "js.dom.setAttributeNS.3@d4": (o: any, a: any, b: any, c: any) => toDyn(o.setAttributeNS(a, b, c)),
    "js.dom.removeAttributeNS.2": (o: any, a: any, b: any) => o.removeAttributeNS(a, b), "js.dom.removeAttributeNS.2@d3": (o: any, a: any, b: any) => toDyn(o.removeAttributeNS(a, b)),
    "js.dom.getAttribute.1": (o: any, a: any) => o.getAttribute(a), "js.dom.getAttribute.1@d2": (o: any, a: any) => toDyn(o.getAttribute(a)),
    "js.dom.hasAttribute.1": (o: any, a: any) => o.hasAttribute(a), "js.dom.hasAttribute.1@d2": (o: any, a: any) => toDyn(o.hasAttribute(a)),
    "js.dom.createElement.1": (o: any, a: any) => o.createElement(a), "js.dom.createElement.1@d2": (o: any, a: any) => toDyn(o.createElement(a)),
    "js.dom.createElement.2": (o: any, a: any, b: any) => o.createElement(a, b), "js.dom.createElement.2@d3": (o: any, a: any, b: any) => toDyn(o.createElement(a, b)),
    "js.dom.createElementNS.2": (o: any, a: any, b: any) => o.createElementNS(a, b), "js.dom.createElementNS.2@d3": (o: any, a: any, b: any) => toDyn(o.createElementNS(a, b)),
    "js.dom.createElementNS.3": (o: any, a: any, b: any, c: any) => o.createElementNS(a, b, c), "js.dom.createElementNS.3@d4": (o: any, a: any, b: any, c: any) => toDyn(o.createElementNS(a, b, c)),
    "js.dom.createTextNode.1": (o: any, a: any) => o.createTextNode(a), "js.dom.createTextNode.1@d2": (o: any, a: any) => toDyn(o.createTextNode(a)),
    "js.dom.createComment.1": (o: any, a: any) => o.createComment(a), "js.dom.createComment.1@d2": (o: any, a: any) => toDyn(o.createComment(a)),
    "js.dom.addEventListener.2": (o: any, a: any, b: any) => o.addEventListener(a, b), "js.dom.addEventListener.2@d3": (o: any, a: any, b: any) => toDyn(o.addEventListener(a, b)),
    "js.dom.addEventListener.3": (o: any, a: any, b: any, c: any) => o.addEventListener(a, b, c), "js.dom.addEventListener.3@d4": (o: any, a: any, b: any, c: any) => toDyn(o.addEventListener(a, b, c)),
    "js.dom.removeEventListener.2": (o: any, a: any, b: any) => o.removeEventListener(a, b), "js.dom.removeEventListener.2@d3": (o: any, a: any, b: any) => toDyn(o.removeEventListener(a, b)),
    "js.dom.removeEventListener.3": (o: any, a: any, b: any, c: any) => o.removeEventListener(a, b, c), "js.dom.removeEventListener.3@d4": (o: any, a: any, b: any, c: any) => toDyn(o.removeEventListener(a, b, c)),
    "js.dom.contains.1": (o: any, a: any) => o.contains(a), "js.dom.contains.1@d2": (o: any, a: any) => toDyn(o.contains(a)),
    "js.dom.getRootNode.0": (o: any) => o.getRootNode(), "js.dom.getRootNode.0@d1": (o: any) => toDyn(o.getRootNode()),
    "js.dom.getRootNode.1": (o: any, a: any) => o.getRootNode(a), "js.dom.getRootNode.1@d2": (o: any, a: any) => toDyn(o.getRootNode(a)),
    "js.dom.setProperty.2": (o: any, a: any, b: any) => o.setProperty(a, b), "js.dom.setProperty.2@d3": (o: any, a: any, b: any) => toDyn(o.setProperty(a, b)),
    "js.dom.setProperty.3": (o: any, a: any, b: any, c: any) => o.setProperty(a, b, c), "js.dom.setProperty.3@d4": (o: any, a: any, b: any, c: any) => toDyn(o.setProperty(a, b, c)),
    "js.dom.removeProperty.1": (o: any, a: any) => o.removeProperty(a), "js.dom.removeProperty.1@d2": (o: any, a: any) => toDyn(o.removeProperty(a)),
    "js.dom.focus.0": (o: any) => o.focus(), "js.dom.focus.0@d1": (o: any) => toDyn(o.focus()),
    "js.dom.focus.1": (o: any, a: any) => o.focus(a), "js.dom.focus.1@d2": (o: any, a: any) => toDyn(o.focus(a)),
    "js.dom.blur.0": (o: any) => o.blur(), "js.dom.blur.0@d1": (o: any) => toDyn(o.blur()),
    "js.dom.get.ownerDocument": (o: any) => o.ownerDocument, "js.dom.get.ownerDocument@d1": (o: any) => toDyn(o.ownerDocument),
    "js.dom.get.nodeType": (o: any) => o.nodeType, "js.dom.get.nodeType@d1": (o: any) => toDyn(o.nodeType),
    "js.dom.get.nodeName": (o: any) => o.nodeName, "js.dom.get.nodeName@d1": (o: any) => toDyn(o.nodeName),
    "js.dom.get.tagName": (o: any) => o.tagName, "js.dom.get.tagName@d1": (o: any) => toDyn(o.tagName),
    "js.dom.get.namespaceURI": (o: any) => o.namespaceURI, "js.dom.get.namespaceURI@d1": (o: any) => toDyn(o.namespaceURI),
    "js.dom.get.firstChild": (o: any) => o.firstChild, "js.dom.get.firstChild@d1": (o: any) => toDyn(o.firstChild),
    "js.dom.get.lastChild": (o: any) => o.lastChild, "js.dom.get.lastChild@d1": (o: any) => toDyn(o.lastChild),
    "js.dom.get.nextSibling": (o: any) => o.nextSibling, "js.dom.get.nextSibling@d1": (o: any) => toDyn(o.nextSibling),
    "js.dom.get.previousSibling": (o: any) => o.previousSibling, "js.dom.get.previousSibling@d1": (o: any) => toDyn(o.previousSibling),
    "js.dom.get.parentNode": (o: any) => o.parentNode, "js.dom.get.parentNode@d1": (o: any) => toDyn(o.parentNode),
    "js.dom.get.nodeValue": (o: any) => o.nodeValue, "js.dom.get.nodeValue@d1": (o: any) => toDyn(o.nodeValue),
    "js.dom.get.textContent": (o: any) => o.textContent, "js.dom.get.textContent@d1": (o: any) => toDyn(o.textContent),
    "js.dom.get.style": (o: any) => o.style, "js.dom.get.style@d1": (o: any) => toDyn(o.style),
    "js.dom.get.documentElement": (o: any) => o.documentElement, "js.dom.get.documentElement@d1": (o: any) => toDyn(o.documentElement),
    "js.dom.get.defaultView": (o: any) => o.defaultView, "js.dom.get.defaultView@d1": (o: any) => toDyn(o.defaultView),
    "js.dom.get.body": (o: any) => o.body, "js.dom.get.body@d1": (o: any) => toDyn(o.body),
    "js.dom.get.document": (o: any) => o.document, "js.dom.get.document@d1": (o: any) => toDyn(o.document),
    "js.dom.get.head": (o: any) => o.head, "js.dom.get.head@d1": (o: any) => toDyn(o.head),
    "js.dom.get.activeElement": (o: any) => o.activeElement, "js.dom.get.activeElement@d1": (o: any) => toDyn(o.activeElement),
    "js.dom.get.parentElement": (o: any) => o.parentElement, "js.dom.get.parentElement@d1": (o: any) => toDyn(o.parentElement),
    "js.dom.get.id": (o: any) => o.id, "js.dom.get.id@d1": (o: any) => toDyn(o.id),
    "js.dom.get.className": (o: any) => o.className, "js.dom.get.className@d1": (o: any) => toDyn(o.className),
    "js.dom.get.title": (o: any) => o.title, "js.dom.get.title@d1": (o: any) => toDyn(o.title),
    "js.dom.get.hidden": (o: any) => o.hidden, "js.dom.get.hidden@d1": (o: any) => toDyn(o.hidden),
    "js.dom.get.tabIndex": (o: any) => o.tabIndex, "js.dom.get.tabIndex@d1": (o: any) => toDyn(o.tabIndex),
    "js.dom.get.dir": (o: any) => o.dir, "js.dom.get.dir@d1": (o: any) => toDyn(o.dir),
    "js.dom.get.lang": (o: any) => o.lang, "js.dom.get.lang@d1": (o: any) => toDyn(o.lang),
    "js.dom.set.textContent": (o: any, v: any) => { o.textContent = v; },
    "js.dom.set.nodeValue": (o: any, v: any) => { o.nodeValue = v; },
    "js.dom.set.onclick": (o: any, v: any) => { o.onclick = v; },
    "js.dom.set.className": (o: any, v: any) => { o.className = v; },
    "js.dom.set.innerHTML": (o: any, v: any) => { o.innerHTML = v; },
    "js.dom.set.value": (o: any, v: any) => { o.value = v; },
    "js.dom.set.checked": (o: any, v: any) => { o.checked = v; },
    "js.dom.set.selected": (o: any, v: any) => { o.selected = v; },
    "js.dom.set.defaultValue": (o: any, v: any) => { o.defaultValue = v; },
    "js.dom.set.defaultChecked": (o: any, v: any) => { o.defaultChecked = v; },
    "js.dom.set.multiple": (o: any, v: any) => { o.multiple = v; },
    "js.dom.set.muted": (o: any, v: any) => { o.muted = v; },
    "js.dom.set.id": (o: any, v: any) => { o.id = v; },
    "js.dom.set.title": (o: any, v: any) => { o.title = v; },
    "js.dom.set.hidden": (o: any, v: any) => { o.hidden = v; },
    "js.dom.set.tabIndex": (o: any, v: any) => { o.tabIndex = v; },
    "js.dom.set.dir": (o: any, v: any) => { o.dir = v; },
    "js.dom.set.lang": (o: any, v: any) => { o.lang = v; },
    "js.dcall.0@d2": (f: any, t: any) => { if (typeof f !== "function") throw new TypeError(`${String(f)} is not a function`); return toDyn(f.apply(t, [])); },
    "js.dcall.1@d3": (f: any, t: any, a: any) => { if (typeof f !== "function") throw new TypeError(`${String(f)} is not a function`); return toDyn(f.apply(t, [a])); },
    "js.dcall.2@d4": (f: any, t: any, a: any, b: any) => { if (typeof f !== "function") throw new TypeError(`${String(f)} is not a function`); return toDyn(f.apply(t, [a, b])); },
    // GetIterator / the step-result check, with V8's TypeError texts.
    "js.iterator": (v: any, msg: string) => {
      const f = v == null ? undefined : v[Symbol.iterator];
      if (typeof f !== "function") throw new TypeError(msg || `${v === null ? "null" : typeof v === "object" ? "object" : typeof v + " " + String(v)} is not iterable`);
      return f.call(v);
    },
    // Array destructuring's first `n` steps (GetIterator, IteratorStep,
    // IteratorClose when the pattern stops early), as a fresh array.
    "js.iterN": (v: any, n: number, msg: string) => {
      const f = v == null ? undefined : v[Symbol.iterator];
      if (typeof f !== "function") {
        const desc = v === undefined ? "undefined" : v === null ? "null" : typeof v === "function" ? "function" : typeof v === "object" ? "object" : `${typeof v} ${String(v)}`;
        throw new TypeError(msg || `${desc} is not iterable (cannot read property Symbol(Symbol.iterator))`);
      }
      const it = f.call(v), out: unknown[] = new Array(n).fill(undefined);
      let done = false;
      for (let i = 0; i < n; i++) {
        const r = it.next();
        if (r === null || (typeof r !== "object" && typeof r !== "function")) throw new TypeError(`Iterator result ${String(r)} is not an object`);
        if (r.done) { done = true; break; }
        out[i] = r.value;
      }
      if (!done && typeof it.return === "function") it.return();
      return out;
    },
    // Array.from's source as an iterator: its own iterator, else an
    // array-like walk (Array.from's TypeError on null/undefined).
    "js.arrayFromIterator": (v: any) => {
      if (v == null) Array.from(v);
      const method = v[Symbol.iterator];
      if (method != null) return method.call(v);
      const o = Object(v), n = Math.min(Math.max(Math.trunc(Number(o.length)) || 0, 0), Number.MAX_SAFE_INTEGER);
      let i = 0;
      return { next: () => (i < n ? { value: o[i++], done: false } : { value: undefined, done: true }) };
    },
    "js.iterResult": (v: any) => {
      if (v === null || (typeof v !== "object" && typeof v !== "function")) throw new TypeError(`Iterator result ${String(v)} is not an object`);
      return v;
    },
    "js.arrayProtoCall": (recv: any, name: string, args: any) => (Array.prototype as any)[name].apply(recv, args),
    "js.reflectSet": (o: any, k: any, v: any, r: any) => (Reflect.set(Object(o), K(k), v, r) ? 1 : 0),
    // OrdinarySet on a foreign receiver once the target's property is a writable data one: the
    // receiver's own data property takes the value (an accessor or read-only one refuses), else one is created.
    "js.receiverSetData": (r: any, k0: any, v: any) => {
      if (r === null || (typeof r !== "object" && typeof r !== "function")) return 0;
      const k = K(k0), ex = Reflect.getOwnPropertyDescriptor(r, k);
      if (ex) return "value" in ex && ex.writable ? (Reflect.defineProperty(r, k, { value: v }) ? 1 : 0) : 0;
      return Reflect.defineProperty(r, k, { value: v, writable: true, enumerable: true, configurable: true }) ? 1 : 0;
    },
    "js.reflectDefine": (o: any, k: any, d: any) => (Reflect.defineProperty(o, K(k), d) ? 1 : 0),
    "js.objOp1": (name: string, a: any) => (Object as any)[name](a),
    "js.objOp2": (name: string, a: any, b: any) => (Object as any)[name](a, b),
    "js.ownKeys": (o: any) => Reflect.ownKeys(o),
    "js.isCallableMember": (o: any, k: any) => (typeof Object(o)[K(k)] === "function" ? 1 : 0),
    "js.hasOwn": (o: any, k: any) => (Object.prototype.hasOwnProperty.call(o, K(k)) ? 1 : 0),
    "js.isEnumerable": (o: any, k: any) => (Object.prototype.propertyIsEnumerable.call(o, K(k)) ? 1 : 0),
    "js.toNumber": (v: any) => Number(v),
    // ToPropertyKey: a symbol is a key already and any other primitive's key
    // is its ToString; objects go through ToPrimitive (hint string) as a
    // computed key does.
    "js.propertyKey": (v: any) => (typeof v === "symbol" ? v : v === null || (typeof v !== "object" && typeof v !== "function") ? String(v) : Reflect.ownKeys({ [v]: 0 })[0]),
    "js.objectRest": (src: any, excluded: any) => { const out: any = {}; const skip = new Set(Array.from(excluded ?? [])); for (const k of Reflect.ownKeys(Object(src))) if (!skip.has(k) && Object.prototype.propertyIsEnumerable.call(src, k)) out[k] = src[k]; return out; },
    "js.setPrototype": (o: any, p: any) => Object.setPrototypeOf(o, p),
    "js.deferred": () => { const d: any = {}; d.promise = new Promise((res, rej) => { d.resolve = res; d.reject = rej; }); return d; },
    "js.deferredPromise": (d: any) => d.promise,
    "js.settleDeferred": (d: any, v: unknown, rejected: number) => (rejected ? d.reject(v) : d.resolve(v)),
    "js.defineGetter": (o: any, k: any, f: any) => Object.defineProperty(o, K(k), { get: f, enumerable: true, configurable: true }),
    "js.sameValue": (a: any, b: any) => (Object.is(a, b) ? 1 : 0),
    "js.sameValueZero": (a: any, b: any) => (a === b || (a !== a && b !== b) ? 1 : 0),
    // Map/Set over engine values: objects by identity id, primitives by value.
    // A native dyn Map/Set crossing to the page: an empty page collection
    // stamped so it unwraps back to the compiled one, filled entry by entry
    // with the original Map/Set methods; and a page constructor's iteration
    // of a source, its entries returned flat ([k0, v0, k1, v1, ...] / [v0, ...]).
    "js.collection": (struct: object, kind: number) => { if (NATIVE_SIM) return struct; const c = kind ? new Set() : new Map(); FacadeBrand.stamp(c, struct); return c; },
    "js.collectionAdd": (c: any, k: unknown, v: unknown) => { if (c instanceof Map) mapSet.call(c, k, v); else setAdd.call(c, k); },
    // A native Map/Set iterator whose collection crossed to the page: the page's iterator of that kind, past the last key
    // the compiled iterator yielded; a key that left the page collection is refused rather than guessed at.
    "js.collectionResume": (c: any, method: string, hasLast: number, last: any) => {
      const isMap = c instanceof Map, has = isMap ? mapHas : setHas, keys = isMap ? mapKeys : setValues;
      let skip = 0;
      if (hasLast) {
        if (!has.call(c, last)) throw new TypeError(`a ${isMap ? "Map" : "Set"} changed on the page while compiled code was iterating it`);
        const it = keys.call(c) as Iterator<unknown>;
        for (let r = it.next(); !r.done; r = it.next()) { skip++; if (r.value === last || (r.value !== r.value && last !== last)) break; }
      }
      const it = (c as any)[method]() as Iterator<unknown>;
      for (let i = 0; i < skip; i++) it.next();
      return it;
    },
    // Iterator.prototype's helper method of that name (a page without Iterator helpers: undefined).
    "js.iteratorHelper": (name: string) => {
      const P = (globalThis as any).Iterator?.prototype, f = P === undefined ? undefined : Object.getOwnPropertyDescriptor(P, name)?.value;
      return typeof f === "function" ? f : undefined;
    },
    // A page value a WeakMap/WeakSet accepts as a key: an object, a function, or a symbol that is not registered (Symbol.for).
    "js.weakKeyOk": (v: any) => (v !== null && (typeof v === "object" || typeof v === "function")) || (typeof v === "symbol" && Symbol.keyFor(v) === undefined) ? 1 : 0,
    "js.collectionItems": (kind: number, src: any) => {
      const out: unknown[] = [];
      if (kind) setForEach.call(new Set(src), (v: unknown) => { out.push(v); });
      else mapForEach.call(new Map(src), (v: unknown, k: unknown) => { out.push(k, v); });
      return out;
    },
    "js.hashKey": (v: any) => {
      if (v !== null && (typeof v === "object" || typeof v === "function")) return (host["obj.id"] as (o: object) => number)(v);
      if (typeof v === "number") return v === 0 || v !== v ? 0 : (v * 2654435761) | 0;
      const s = typeof v === "symbol" ? (v.description ?? "") : String(v);
      let h = 0x811c9dc5 | 0;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
      return h;
    },
    "js.objectTag": (v: unknown) => Object.prototype.toString.call(v),
    // A compiled Error as a real JS Error (cached per compiled error: identity holds).
    "js.makeError": (struct: object, name: string, message: string, stack: string) => {
      let e = errorObjects.get(struct);
      // The builtin error classes keep their page class (page code tests
      // `instanceof TypeError`); other names are plain Errors with that name.
      const Builtin = BUILTIN_ERRORS.has(name) ? (globalThis as any)[name] : Error;
      if (!e) { e = (name === "AggregateError" && typeof (globalThis as any).AggregateError === "function" ? new (globalThis as any).AggregateError([], message) : new Builtin(message)) as Error; Object.defineProperty(e, "name", { value: name, writable: true, configurable: true, enumerable: false }); e.stack = stack; errorObjects.set(struct, e); errorStructs.set(e, struct); }
      return e;
    },
    // The page form's own `name` / `message` follow the compiled error's presence flags: neither is an own property of
    // `new Error()` until assigned, and `name` is enumerable only when the program assigned it.
    "js.errorShape": (struct: object, e: any, nameOwn: number, nameEnumerable: number, messageOwn: number) => {
      const name = e.name;
      if (nameOwn) Object.defineProperty(e, "name", { value: name, writable: true, configurable: true, enumerable: nameEnumerable !== 0 });
      else if (Object.prototype.hasOwnProperty.call(e, "name")) { delete e.name; if (e.name !== name) Object.defineProperty(e, "name", { value: name, writable: true, configurable: true, enumerable: false }); }
      if (!messageOwn && Object.prototype.hasOwnProperty.call(e, "message")) { const msg = e.message; delete e.message; if (e.message !== msg) Object.defineProperty(e, "message", { value: msg, writable: true, configurable: true, enumerable: false }); }
    },
    // A compiled error made for a caught page error keeps that error as its page form.
    "js.adoptError": (struct: object, e: Error) => { errorObjects.set(struct, e); errorStructs.set(e, struct); },
    // An own, non-enumerable `cause` on a compiled error's page form (InstallErrorCause).
    "js.errorSetCause": (struct: object, e: any, cause: unknown) => { Object.defineProperty(e, "cause", { value: cause, writable: true, enumerable: false, configurable: true }); },
    // An own, non-enumerable data property (AggregateError's `errors`) on a compiled error's page form.
    "js.errorSetProp": (struct: object, e: any, key: string, value: unknown) => { Object.defineProperty(e, key, { value, writable: true, enumerable: false, configurable: true }); },
    "js.errorOwnHas": (struct: object, k: string) => { const e = errorObjects.get(struct); return e !== undefined && Object.prototype.hasOwnProperty.call(e, k) ? 1 : 0; },
    "js.errorOwnGet": (struct: object, k: string) => (errorObjects.get(struct) as any)?.[k],
    "js.traceError": (msg: string) => { console.error(`[wasmgc trace] ${msg}\n${new Error().stack}`); },
    "js.symFor": (s: string) => Symbol.for(s), "js.symWellKnown": (n: string) => (Symbol as any)[n],
    "js.push": (a: any[], v: any) => { a.push(v); }, "js.pushHole": (a: any[]) => { a.length += 1; }, "js.pushAll": (a: any[], v: any) => { a.push(...v); },
    "js.apply": (f: any, t: any, a: any[]) => Reflect.apply(f, t, a),
    "js.arg": (args: any[], i: number) => args[i], "js.length": (a: any) => a.length >>> 0, "js.argsFrom": (args: any[], n: number) => Array.prototype.slice.call(args, n),
    "js.is.string": (v: any) => (typeof v === "string" ? 1 : 0), "js.is.number": (v: any) => (typeof v === "number" ? 1 : 0),
    "js.is.boolean": (v: any) => (typeof v === "boolean" ? 1 : 0), "js.is.undefined": (v: any) => (v === undefined ? 1 : 0),
    "js.is.nullish": (v: any) => (v == null ? 1 : 0), "js.is.array": (v: any) => (Array.isArray(v) ? 1 : 0),
    "js.is.object": (v: any) => (typeof v === "object" ? 1 : 0), "js.is.function": (v: any) => (typeof v === "function" ? 1 : 0),
    "js.is.truthy": (v: any) => (v ? 1 : 0), "js.is.symbol": (v: any) => (typeof v === "symbol" ? 1 : 0),
    "js.is.bigint": (v: any) => (typeof v === "bigint" ? 1 : 0), "js.isView": (v: unknown) => (ArrayBuffer.isView(v) ? 1 : 0), "js.is.error": (v: any) => (v instanceof Error ? 1 : 0),
    // A compiled record by reference: one Proxy per struct, reads/writes
    // through the module's per-shape accessors; unknown keys live on the target.
    // The traps are one handler per record shape (recordFacadeHandler); each
    // facade's struct, Proxy and adoption state live on its target.
    // experimentalOpaquePageExpandos: a typed value stored on a page object
    // is its facade when one exists, else the opaque struct itself.
    "js.setOpaque": (o: any, k: string, struct: object) => { o[k] = facades.get(struct) ?? struct; },
    "js.recordFacade": (struct: object, base: string, names: string, tuple: number) => {
      if (NATIVE_SIM) return struct;
      let p = facades.get(struct);
      if (p) return p;
      const shapeKey = base + "\u0000" + names + "\u0000" + (tuple ? 1 : 0);
      let handler = recordHandlers.get(shapeKey);
      if (!handler) recordHandlers.set(shapeKey, handler = recordFacadeHandler(base, names, tuple));
      const t = RecordTarget.make(tuple ? [] : {}, struct);
      p = new Proxy(t, handler);
      RecordTarget.setProxy(t, p);
      facades.set(struct, p);
      FacadeBrand.stamp(p, struct);
      return p;
    },
    // A compiled class instance by reference: one Proxy per instance over its
    // class's prototype chain (classDesc).
    "js.classFacade": (struct: object, desc: string) => {
      if (NATIVE_SIM) return struct;
      let p = facades.get(struct);
      if (p) return p;
      const d = classDesc(desc);
      const t = RecordTarget.make(Object.create(d.proto) as object, struct);
      p = new Proxy(t, d.handler);
      RecordTarget.setProxy(t, p);
      facades.set(struct, p);
      FacadeBrand.stamp(p, struct);
      return p;
    },
    // A compiled sync generator by reference: an iterator object over the module's per-type step export.
    "js.genFacade": (g: object, base: string) => {
      if (NATIVE_SIM) return g;
      let p = facades.get(g);
      if (p) return p;
      const ex = state.exports!, drive = ex[base] as (g: object, mode: number, sent: unknown) => unknown, done = ex["genDone"] as () => number;
      const step = (mode: number, sent: unknown) => { const value = drive(g, mode, sent); return { value, done: done() !== 0 }; };
      p = Object.create(generatorFacadeProto, {
        next: { value: (v: unknown) => step(0, v) }, return: { value: (v: unknown) => step(2, v) }, throw: { value: (e: unknown) => step(1, e) },
      });
      FacadeBrand.stamp(p!, g);
      facades.set(g, p!);
      return p;
    },
    // A compiled array by reference: a Proxy over [] (Array.isArray holds),
    // indices and length through the module's per-element-type accessors.
    "js.arrayFacade": (arr: object, base: string) => {
      if (NATIVE_SIM) return arr;
      let p = facades.get(arr);
      if (p) return p;
      const ex = state.exports!;
      const get = ex[`${base}Get`] as (a: object, i: number) => unknown, set = ex[`${base}Set`] as (a: object, i: number, v: unknown) => void;
      const len = ex[`${base}Len`] as (a: object) => number, setLen = ex[`${base}SetLen`] as (a: object, n: number) => void;
      const has = ex[`${base}Has`] as (a: object, i: number) => number, hole = ex[`${base}Hole`] as (a: object, i: number) => void;
      const idx = (k: string | symbol): number => (typeof k === "string" && String(+k >>> 0) === k && +k < 4294967295 ? +k : -1);
      // A match result (RegExpExecArray) is the array itself: its own index, input and groups live in the struct.
      const matchIs = ex[`${base}MatchIs`] as ((a: object) => number) | undefined;
      const matchGet = ex[`${base}MatchGet`] as (a: object, w: number) => unknown, matchSet = ex[`${base}MatchSet`] as (a: object, w: number, v: unknown) => void;
      const isMatch = matchIs !== undefined && matchIs(arr) !== 0;
      const own = (k: string | symbol): number => (isMatch ? (k === "index" ? 0 : k === "input" ? 1 : k === "groups" ? 2 : -1) : -1);
      const setOwn = (w: number, v: unknown): void => {
        if (w === 0 && typeof v !== "number") throw new TypeError("a typed match result's index takes a number");
        if (w === 1 && typeof v !== "string") throw new TypeError("a typed match result's input takes a string");
        if (w === 2) throw new TypeError("replacing the groups of a typed match result is not supported yet");
        matchSet(arr, w, v);
      };
      const frozenOf = ex[`${base}Frozen`] as ((a: object) => number) | undefined, freezeOf = ex[`${base}Freeze`] as ((a: object) => void) | undefined;
      // `length = v`: JS's RangeError for a length that is not an integer in [0, 2^32), 2^31 and more an implementation limit.
      const lengthOf = (v: unknown): number => {
        const n = Number(v);
        if (n !== n >>> 0) throw new RangeError("Invalid array length");
        if (n >= 2147483648) throw new RangeError("array lengths of 2^31 or more are not supported");
        return n;
      };
      const arrayOps: ArrayOps | null = frozenOf && freezeOf && !isMatch ? {
        level: () => (frozenOf(arr) !== 0 ? 2 : 0), apply: (l) => { if (l === 2) freezeOf(arr); else throw new TypeError("a compiled typed array cannot be sealed by JavaScript (freeze it instead)"); },
        present: () => Array.from({ length: len(arr) }, (_, i) => i).filter((i) => has(arr, i) !== 0), len: () => len(arr), get: (i) => get(arr, i), set: (i, v) => { set(arr, i, v); }, setLen: (n) => { setLen(arr, lengthOf(n)); }, canSeal: false,
      } : null;
      // Holes are absent keys (in, Object.keys, descriptors), exactly as in JS.
      p = new Proxy([], {
        get: (t, k, r) => (k === "length" ? len(arr) : idx(k) >= 0 ? get(arr, idx(k)) : own(k) >= 0 ? matchGet(arr, own(k)) : Reflect.get(t, k, r)),
        set: (t, k, v, r) => {
          // A frozen array takes no write: strict code's TypeError, as V8 words it.
          if ((k === "length" || idx(k) >= 0) && frozenOf !== undefined && frozenOf(arr) !== 0) throw new TypeError(`Cannot assign to read only property '${String(k)}' of object '[object Array]'`);
          if (k === "length") setLen(arr, lengthOf(v)); else if (idx(k) >= 0) set(arr, idx(k), v); else if (own(k) >= 0) setOwn(own(k), v); else return Reflect.set(t, k, v, r); return true; },
        has: (t, k) => (idx(k) >= 0 ? has(arr, idx(k)) !== 0 : own(k) >= 0 ? true : Reflect.has(t, k)),
        ownKeys: (t) => [...Array.from({ length: len(arr) }, (_, i) => i).filter((i) => has(arr, i) !== 0).map(String), ...Reflect.ownKeys(t).filter((k) => typeof k !== "string" || idx(k) < 0), ...(isMatch ? ["index", "input", "groups"] : [])],
        getOwnPropertyDescriptor: (t, k) => {
          if (k === "length") return arrayOps !== null ? arrayDescriptor(t, "length", len(arr), arrayOps) : { value: len(arr), writable: true, enumerable: false, configurable: false };
          if (own(k) >= 0) return { value: matchGet(arr, own(k)), writable: true, enumerable: true, configurable: true };
          const i = idx(k);
          if (i >= 0 && has(arr, i) !== 0) return arrayOps !== null ? arrayDescriptor(t, String(i), get(arr, i), arrayOps) : { value: get(arr, i), writable: true, enumerable: true, configurable: true };
          return i >= 0 ? undefined : Reflect.getOwnPropertyDescriptor(t, k);
        },
        deleteProperty: (t, k) => {
          if (own(k) >= 0) throw new TypeError("deleting a typed match result's index, input or groups is not supported yet");
          const i = idx(k); if (i >= 0) { hole(arr, i); return true; } return Reflect.deleteProperty(t, k);
        },
        // Integrity from the page (Object.freeze, preventExtensions) reaches the array's frozen level; a compiled array takes no accessors.
        preventExtensions: (t) => (arrayOps !== null && arrayPreventExtensions(t, arrayOps)),
        isExtensible: (t) => { if (arrayOps !== null) syncArray(t, arrayOps); return Reflect.isExtensible(t); },
        defineProperty: (t, k, d) => {
          if (arrayOps !== null && typeof k === "string" && own(k) < 0) { syncArray(t, arrayOps); if (!Reflect.isExtensible(t)) return arrayDefineLocked(t, k, d, arrayOps); }
          const i = idx(k);
          if (own(k) >= 0) {
            if ("get" in d || "set" in d || d.writable === false || d.enumerable === false || d.configurable === false) throw new TypeError("a typed match result's index, input and groups take only plain writable data descriptors");
            if ("value" in d) setOwn(own(k), d.value);
            return true;
          }
          if (i < 0) return Reflect.defineProperty(t, k, d);
          if ("get" in d || "set" in d || d.writable === false || d.configurable === false) throw new TypeError("a compiled array element cannot take an accessor or a non-writable descriptor");
          if ("value" in d) set(arr, i, d.value);
          return true;
        },
      });
      facades.set(arr, p);
      facadeStructs.set(p, arr);
      return p;
    },
    "js.nullObj": () => Object.create(null),
    // dyn.isPristineArrayIterable's page half: the array iteration protocol
    // is still the engine's own (pristineArrayIteration).
    // js.arrayMemberPristine(name): the page's Array.prototype[name] is still the engine's own native function (a data property).
    "js.arrayMemberPristine": (name: string) => { const f = arrayMembers.get(name); return f !== undefined && Object.getOwnPropertyDescriptor(Array.prototype, name)?.value === f ? 1 : 0; },
    "js.iterPristine": (kind: number) => { const f = kindIteration[kind]; return f != null && f() ? 1 : 0; },
    "js.arrayIterPristine": () => (arrayIteration !== null && arrayIteration.pristine() ? 1 : 0),
    // dyn.arrayIteratorAt: the engine's array iterator over v, advanced n steps by its own next.
    "js.arrayIterAt": (v: any, n: number) => arrayIteration!.at(v, n),
    "js.unwrapFacade": (v: any) => (v !== null && typeof v === "object" ? FacadeBrand.structOf(v) ?? facadeStructs.get(v) ?? errorStructs.get(v) ?? null : null),
    // Any of our page-side wrappers (record/array/dyn facades, function wrappers) → the compiled value.
    "js.unwrapAny": (v: any) => (typeof v === "object" ? (v !== null && (ourObject(v) || errorStructs.get(v) || adoptPageBuffer(v))) || null : typeof v === "function" ? ourFunction(v) ?? null : null),
    // A compiled native-dyn object or array as a live page object. Traps call
    // the module's dynFacade* exports; unknown keys fall back to the page's
    // own prototype for the kind (Array.prototype methods work on arrays).
    // Called once per object: the compiled side caches the facade (struct
    // `js` field). React-DOM makes one per element's fiber and props, so
    // creation is kept to a target, a Proxy and two stamps: the traps are
    // one handler per kind, and each facade's compiled reference and Proxy
    // live on its target as private fields (DynTarget).
    "js.dynFacade": (ref: object, kind: number) => {
      // Native-host simulation (tests only): the compiled value itself is its facade, an identity token the host cannot store on or list.
      if (NATIVE_SIM) return ref;
      // A facade js.setFacade issued whose page store is still running (a
      // page setter or Proxy trap crossed the same value back): that one.
      for (let i = facadeFlight.length - 2; i >= 0; i -= 2) if (facadeFlight[i] === ref) return facadeFlight[i + 1]!;
      return makeDynFacade(ref, kind);
    },
    // `o[k] = v` where v is a compiled object or array crossing for the first
    // time: its facade is created and stored in one call, and returned for
    // the module to cache. Until the store returns, the facade is in flight
    // (js.dynFacade hands it to a re-entrant crossing); if the store throws,
    // the module adopts it before the exception propagates, so identity
    // holds either way.
    "js.setFacade": (o: any, k: any, ref: object, kind: number) => {
      if (NATIVE_SIM) { try { o[k] = ref; } catch { /* a frozen page object */ } return ref; }
      const p = makeDynFacade(ref, kind);
      facadeFlight.push(ref, p);
      // (No finally: it costs this hot path about a fifth, measured.)
      try { o[k] = p; } catch (e) { facadeFlight.pop(); facadeFlight.pop(); (state.exports!["dynFacadeAdopt"] as (r: object, p: object) => void)(ref, p); throw e; }
      facadeFlight.pop(); facadeFlight.pop();
      return p;
    },
    // `o[k]` with a computed key on a page object: our own object/array
    // facade comes back as its compiled reference (one brand check), so the
    // module skips js.classify and js.unwrapAny for React's expando reads.
    "js.getUnwrap": (o: any, k: any) => { const v = o[K(k)]; return typeof v === "object" && v !== null ? FacadeBrand.structOf(v) ?? v : v; },
    // SCRIPTC_WASMGC_FACADE_LEGACY builds: the host caches facades in a WeakMap.
    "js.dynFacadeCached": (ref: object, kind: number) => {
      let p = facades.get(ref);
      if (!p) { p = (host["js.dynFacade"] as (r: object, k: number) => object)(ref, kind); facades.set(ref, p); }
      return p;
    },
    // A page builtin the module implements natively (Object.prototype.hasOwnProperty,
    // Object.prototype.toString, Object.is): inside the module its compiled closure
    // stands for it (a page read of the builtin classifies as that closure, so
    // identity holds and calls stay in Wasm) and the closure crosses back as the
    // builtin itself (the module caches the returned function on the closure).
    // Per instance; the first adoption of a builtin wins.
    "js.adoptBuiltin": (closure: object, path: string) => {
      const f = path.split(".").reduce((o: any, k: string) => o?.[k], G);
      if (typeof f === "function" && ourFunction(f) === undefined) wrapped.set(f, closure);
      return f;
    },
    "js.unwrapFn": (f: any) => (typeof f === "function" ? wrapped.get(f) ?? ClosureBrand.closureOf(f) ?? typedFnClosures.get(f) ?? null : null),
    // A compiled function as an engine function: one wrapper per closure
    // (function identity), passing this and the actual arguments.
    // The compiled side caches the wrapper on the closure (one call per
    // function). Recognition is by exact identity: only the wrapper object
    // issued here unwraps (a Proxy of it or a copy of its properties is a
    // different page function); its brand is a private field (ClosureBrand).
    "js.fromDynFn": (closure: object, invoker: string, name: string, length: number, flags: number) => {
      const f = pageWrapper(name, length, flags, dynInvoker(closure, invoker));
      ClosureBrand.stamp(f, closure);
      return f;
    },
    // Engine dyn (closures carry no cache field) and SCRIPTC_WASMGC_FNCACHE_LEGACY
    // builds: the host caches wrappers in WeakMaps.
    "js.fromDynFnCached": (closure: object, invoker: string, name: string, length: number, flags: number) => {
      let f = legacyFns.get(closure);
      if (!f) {
        f = pageWrapper(name, length, flags, dynInvoker(closure, invoker));
        legacyFns.set(closure, f);
        wrapped.set(f, closure);
      }
      return f;
    },
  });
  // js.toStr doubles as the strict string exit; the island's String(v) coercion is toStr in jsOp.
  host["js.toStrOp"] = (a: unknown) => String(a);
  // SCRIPTC_WASMGC_TRACE_THROWS builds: a compiled throw is about to happen; the stack says where.
  host["debug.thrown"] = () => console.trace("[scriptc] compiled throw");
  // ToString proper: a Symbol is a TypeError (a template literal's conversion).
  host["js.toStrStrict"] = (a: unknown) => `${a as string}`;
  // Regex: the engine's RegExp; match results cross through a cursor.
  // Items keep undefined (a nonparticipating capture): re.undef reports it, re.item reads "" there.
  let rows: (string | undefined)[][] = [], rowIdx: number[] = [], items: (string | undefined)[] = [];
  let rowMatches: RegExpMatchArray[] = [];
  let matchIdx = 0, groupKeys: string[] = [], groupVals: (string | undefined)[] = [];
  const strs = (m: ArrayLike<string | undefined>) => Array.from(m);
  /** Make `r` the current match: its items, index (-1: a global String.match list has none) and named groups. */
  const setCurrent = (r: RegExpMatchArray): number => {
    items = strs(r); matchIdx = r.index ?? -1;
    const g = r.groups as Record<string, string | undefined> | undefined;
    groupKeys = g ? Object.keys(g) : []; groupVals = g ? groupKeys.map(k => g[k]) : [];
    return items.length;
  };
  // Own-key snapshots (hostHandles): [[OwnPropertyKeys]] runs once at open; items are read by index.
  // kind 0 Object.keys, 1 Object.getOwnPropertyNames, 2 Object.getOwnPropertySymbols, 3 Reflect.ownKeys,
  // 4 for-in keys (EnumerateObjectProperties: enumerable string keys of the object then its prototype chain, nearer keys shadowing).
  let ownKeySnapshot: (string | symbol)[] = [];
  host["js.ownKeysOpen"] = (o: any, kind: number): number => {
    ownKeySnapshot = kind === 0 ? Object.keys(o) : kind === 1 ? Object.getOwnPropertyNames(o) : kind === 2 ? Object.getOwnPropertySymbols(o) : kind === 4 ? (() => { const ks: string[] = []; for (const k in o) ks.push(k); return ks; })() : Reflect.ownKeys(o);
    return ownKeySnapshot.length;
  };
  host["js.ownKeysItem"] = (i: number): string | symbol => ownKeySnapshot[i]!;
  Object.assign(host, {
    "re.new": (pattern: string, flags: string) => new RegExp(pattern, flags),
    "re.test": (re: RegExp, s: string) => (re.test(s) ? 1 : 0),
    "re.source": (re: RegExp) => re.source, "re.flags": (re: RegExp) => re.flags, "re.toString": (re: RegExp) => String(re),
    "re.lastIndex": (re: RegExp) => re.lastIndex, "re.setLastIndex": (re: RegExp, v: number) => { re.lastIndex = v; },
    "re.search": (s: string, re: RegExp) => s.search(re),
    "re.replace": (s: string, re: RegExp, rep: string) => s.replace(re, rep),
    "re.replaceAll": (s: string, re: RegExp, rep: string) => s.replaceAll(re, rep),
    "re.split": (s: string, re: RegExp, limit: number) => { items = s.split(re, limit) as string[]; items = strs(items); return items.length; },
    "re.matchValue": (s: string, re: RegExp, exec: number) => (exec ? re.exec(s) : s.match(re)),
    "re.is": (v: unknown) => (v instanceof RegExp ? 1 : 0),
    "process.envPairs": () => {
      const proc = (globalThis as { process?: { env?: Record<string, string> } }).process;
      if (proc === undefined) throw new ReferenceError("process is not defined");
      return Object.entries(proc.env ?? {}).flat();
    },
    "re.match": (s: string, re: RegExp, exec: number) => {
      const r = exec ? re.exec(s) : s.match(re);
      if (!r) return -1;
      return setCurrent(r);
    },
    // The index of the last single re.match (exec, or String.match without g); -1 when that result carries
    // no index (the list String.match makes for a global regex). The argument is ignored.
    "re.matchIndex": (_i: number) => matchIdx,
    // The last re.match result's named groups, in the order of its groups object: the count (0: groups is
    // undefined), each name, and each value (re.groupUndef: a nonparticipating group).
    "re.groupCount": () => groupKeys.length,
    "re.groupName": (i: number) => groupKeys[i]!,
    "re.groupItem": (i: number) => groupVals[i] ?? "",
    "re.groupUndef": (i: number) => (groupVals[i] === undefined ? 1 : 0),
    "re.matchAll": (s: string, re: RegExp) => { const all = [...s.matchAll(re)]; rowMatches = all; rows = all.map(strs); rowIdx = all.map(x => x.index ?? 0); return rows.length; },
    // Row i becomes the current match: re.item/re.undef, re.matchIndex and re.group* answer for it until the
    // next re.match / re.row / re.split.
    "re.row": (i: number) => setCurrent(rowMatches[i]!),
    "re.rowIndex": (i: number) => rowIdx[i]!,
    "re.item": (i: number) => items[i] ?? "",
    "re.undef": (i: number) => (items[i] === undefined ? 1 : 0),
  });
  // Identity hashes for Map/Set reference keys: numbered once per object.
  const ids = new WeakMap<object, number>();
  let nextId = 1;
  host["obj.id"] = (o: object) => { let id = ids.get(o); if (id === undefined) { id = nextId++; ids.set(o, id); } return id; };
  // JS errors caught in Wasm: the class name of a real Error ("" otherwise) and its message.
  host["js.errorClass"] = (e: unknown) => (e instanceof Error ? e.constructor.name : "");
  host["js.errorMessage"] = (e: Error) => String(e.message);
  host["js.errorName"] = (e: Error) => String(e.name);
  // import.meta for compiled modules: env (Vite's build-time values), the
  // page's URL, and no HMR.
  const page = (globalThis as { location?: { href: string } }).location?.href ?? "";
  (globalThis as Record<string, unknown>)["__wasmgcImportMeta"] = { env: opts.env ?? {}, url: page, hot: undefined };
  // import(key) of a module outside the program: a lazy loader when the page gives one (module evaluation at
  // import() time, as JS), else a provided namespace, else a rejected promise (a failed import, catchable as in JS).
  host["island.importDyn"] = (key: string, target: unknown) => {
    const settle = (v: unknown, rejected: number) => { (state.exports!["jsSettle"] as (t: unknown, v: unknown, r: number) => void)(target, v, rejected); };
    const ns = opts.modules?.[key];
    const loaded = opts.importModule ? opts.importModule(key)
      : ns ? Promise.resolve(ns) : Promise.reject(new TypeError(`Failed to import module "${key}": it was not provided to instantiateWasmGc({ modules, importModule })`));
    loaded.then(v => settle(v, 0), e => settle(e, 1));
  };
  host["island.import"] = (_key: string, exportName: string, pkg: string) => {
    const ns = opts.modules?.[pkg];
    if (!ns) throw new Error(`package "${pkg}" was not provided to instantiateWasmGc({ modules })`);
    return exportName === "*" ? ns : ns[exportName];
  };
  // experimentalDomMirror: a mirrored node's DOM_DIRECT reads, stores and
  // queries (dom-mirror.ts: the module decides when they may run page code).
  for (const k of DOM_DIRECT.get) host[`js.domm.get.${k}@d1`] = host[`js.dom.get.${k}@d1`];
  for (const k of DOM_DIRECT.set) host[`js.domm.set.${k}`] = host[`js.dom.set.${k}`];
  for (const [method, counts] of Object.entries(DOM_DIRECT.methods)) for (const n of counts) host[`js.domm.call.${method}.${n}@d${n + 1}`] = host[`js.dom.${method}.${n}@d${n + 1}`];
  // Every DOM_DIRECT member the emitter may import has its functions above.
  for (const [method, counts] of Object.entries(DOM_DIRECT.methods)) for (const n of counts) if (typeof host[`js.dom.${method}.${n}@d${n + 1}`] !== "function") throw new Error(`host: js.dom.${method}.${n} is missing`);
  for (const k of DOM_DIRECT.get) if (typeof host[`js.dom.get.${k}@d1`] !== "function") throw new Error(`host: js.dom.get.${k} is missing`);
  for (const k of DOM_DIRECT.set) if (typeof host[`js.dom.set.${k}`] !== "function") throw new Error(`host: js.dom.set.${k} is missing`);
  // The host-backed Date members (DATE_HOST_MEMBERS): each is exactly `d.<method>(...args)`; the statics are Date.parse / Date.UTC.
  for (const [method, member] of Object.entries(DATE_HOST_MEMBERS))
    for (const n of member.arities) host[`js.date.${method}.${n}`] = (d: any, ...a: any[]) => d[method](...a);
  // ToPrimitive of a page value (the compiled-side island operators): hint 0 default, 1 number, 2 string; a primitive answers itself.
  host["js.toPrimitive"] = (v: any, hint: number) => {
    if (v === null || (typeof v !== "object" && typeof v !== "function")) return v;
    const exotic = v[Symbol.toPrimitive];
    const isPrimitive = (r: any) => r === null || (typeof r !== "object" && typeof r !== "function");
    if (exotic !== undefined && exotic !== null) {
      const r = exotic.call(v, hint === 1 ? "number" : hint === 2 ? "string" : "default");
      if (isPrimitive(r)) return r;
      throw new TypeError("Cannot convert object to primitive value");
    }
    for (const k of hint === 2 ? ["toString", "valueOf"] : ["valueOf", "toString"]) {
      const f = v[k];
      if (typeof f === "function") { const r = f.call(v); if (isPrimitive(r)) return r; }
    }
    throw new TypeError("Cannot convert object to primitive value");
  };
  for (const method of DATE_LOCALE_METHODS) host[`js.date.${method}.2j`] = (d: any, locales: any, json: string) =>
    d[method](typeof locales === "string" && locales.startsWith("[") ? JSON.parse(locales) : locales, json === "" ? undefined : JSON.parse(json));
  host["js.date.parse.1"] = (s: any) => Date.parse(s);
  for (const n of DATE_UTC_ARITIES) host[`js.date.UTC.${n}`] = (...a: any[]) => (Date.UTC as (...x: number[]) => number)(...a);
  for (const name of MATH_IMPORTS) host[`math.${name}`] = (Math as unknown as Record<string, (...args: number[]) => number>)[name];
  // NATIVE_SIM: the native host refuses a member operation on a compiled (opaque) value ("not a host object"). The web host's `in`,
  // hasOwnProperty and propertyIsEnumerable answer false for one silently, so those refuse here too and a fixture sees the gap.
  if (NATIVE_SIM) {
    // The native host has no page prototypes: a compiled value's inherited builtin members are compiled closures there (never js.builtinMethod).
    const builtinMethod = host["js.builtinMethod"];
    if (typeof builtinMethod === "function") host["js.builtinMethod"] = (ctor: unknown, name: unknown) => { throw new TypeError(`js.builtinMethod(${String(ctor)}, ${String(name)}): the native host has no page prototypes`); };
    const opaqueValue = (v: unknown): boolean => { if (v === null || (typeof v !== "object" && typeof v !== "function")) return false; try { void (v as any).__probe; return false; } catch { return true; } };
    for (const name of ["js.hasProp", "js.hasOwn", "js.isEnumerable", "js.ownKeysOpen", "js.get", "js.set", "js.getUnwrap", "js.length", ...Object.keys(host).filter(k => /^js\.callMethod\.\d+@d\d+$/.test(k))]) {
      const f = host[name] as ((...a: unknown[]) => unknown) | undefined;
      if (typeof f !== "function") continue;
      // (No rest/spread and no Function.prototype.call: a fixture may have patched the page's iterators and prototypes.)
      host[name] = function (this: unknown, o: unknown, k: unknown) {
        // The native host has no String/Number/Boolean/Symbol prototypes: a member of a primitive is compiled-side, never the host's.
        if (isPrimitiveReceiver(o)) throw new TypeError(`Cannot use '${typeof k === "string" || typeof k === "symbol" ? String(k) : ""}' on a primitive: not a host object (${name})`);
        if (opaqueValue(o)) throw new TypeError(`Cannot use '${typeof k === "string" || typeof k === "symbol" ? String(k) : ""}' on Opaque: not a host object (${name})`);
        return Reflect.apply(f, this, arguments as unknown as ArrayLike<unknown>);
      };
    }
  }
  // SCRIPTC_WASMGC_NATIVE_SIM_TRACE=1 (tests only, with NATIVE_SIM): name every import handed a compiled (opaque) value.
  if (NATIVE_SIM && typeof process !== "undefined" && process.env?.["SCRIPTC_WASMGC_NATIVE_SIM_TRACE"] === "1") {
    const opaque = (v: unknown): boolean => { if (v === null || (typeof v !== "object" && typeof v !== "function")) return false; try { void (v as any).__probe; return false; } catch { return true; } };
    for (const [k, f] of Object.entries(host)) {
      if (typeof f !== "function" || k.startsWith("log.") || k.startsWith("error.")) continue;
      host[k] = function (this: unknown, ...a: unknown[]) {
        if (a.some(opaque)) process.stderr.write(`NATIVE_SIM_TRACE ${k} ${new Error().stack?.split("\n").slice(2, 5).map(l => l.trim().replace(/\(.*[\\/]/, "(")).join(" < ")}\n`);
        return (f as Function).apply(this, a);
      };
    }
  }
  return { host };
}

/** Structured-clone sinks (WebIDL `any` positions the browser serialises): the message of postMessage, the state of pushState / replaceState. A compiled
 * value crosses as a facade Proxy, which the browser cannot clone (DataCloneError), so the sink is retried with the value's structured clone
 * made of plain page data. Only a failed clone retries; a value the browser could clone goes through untouched. */
const SINK_METHODS = new Set(["postMessage", "pushState", "replaceState"]);
const toPlain = (v: unknown, seen: Map<object, unknown> = new Map()): unknown => {
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v)) return seen.get(v);
  if (Array.isArray(v)) {
    const out: unknown[] = []; seen.set(v, out);
    for (let i = 0; i < v.length; i++) if (i in v) out[i] = toPlain(v[i], seen); else out.length = i + 1;
    return out;
  }
  // A compiled typed array crosses as a view over module memory, which no structured clone can carry (the memory's
  // buffer is shared or resizable): its bytes, copied into a buffer of their own.
  if (ArrayBuffer.isView(v)) {
    const b = v.buffer as ArrayBuffer & { resizable?: boolean };
    if (isShared(b) || b.resizable === true) {
      const copy = copyView(v);
      seen.set(v, copy);
      return copy;
    }
  }
  // Native page values (Map, Set, Date, typed arrays, Blob, ...) clone themselves; only plain-object-shaped values are copied.
  if (Object.prototype.toString.call(v) !== "[object Object]") return v;
  const out: Record<string, unknown> = {}; seen.set(v, out);
  for (const k of Object.keys(v)) out[k] = toPlain((v as Record<string, unknown>)[k], seen);
  return out;
};
/** Whether a JSON copy of `v` is the same data: only plain objects, arrays and primitives, all the way down. */
const jsonFaithful = (v: unknown, seen: Set<object>): boolean => {
  if (v === null || typeof v !== "object") return typeof v !== "function" && typeof v !== "symbol" && typeof v !== "bigint";
  if (seen.has(v)) return false;
  seen.add(v);
  if (Array.isArray(v)) { for (const x of v) if (!jsonFaithful(x, seen)) return false; return true; }
  const p = Object.getPrototypeOf(v);
  if (p !== Object.prototype && p !== null) return false;
  for (const k of Object.keys(v)) if (!jsonFaithful((v as Record<string, unknown>)[k], seen)) return false;
  return true;
};
/** A transfer list without what cannot be transferred: a compiled buffer crosses as module memory (a view over it,
 * its SharedArrayBuffer, or its resizable ArrayBuffer), which no structured clone can detach; the plain copy of
 * the message carries those bytes, and the compiled source stays as it was (it is never detached). */
const transferable = (t: unknown): boolean =>
  !ArrayBuffer.isView(t) && !isShared(t) && !(t instanceof ArrayBuffer && (t as ArrayBuffer & { resizable?: boolean }).resizable === true);
const plainTransfer = (arg: unknown): unknown => {
  if (Array.isArray(arg)) return arg.filter(transferable);
  if (arg !== null && typeof arg === "object" && Array.isArray((arg as { transfer?: unknown }).transfer)) {
    return { ...(arg as object), transfer: (arg as { transfer: unknown[] }).transfer.filter(transferable) };
  }
  return arg;
};
const callSink = (o: any, k: string, args: unknown[]): unknown => {
  try { return o[k](...args); } catch (e) {
    if (!(e instanceof DOMException) || e.name !== "DataCloneError") throw e;
    return o[k](toPlain(args[0]), ...args.slice(1).map(plainTransfer));
  }
};
const ARITY_OPS: Record<string, (...a: any[]) => unknown> = {
  callMethod: (o, k, ...a) => o[k](...a), callFn: (f, ...a) => f(...a), callFnThis: (f, t, ...a) => f.apply(t, a),
  construct: (C, ...a) => new C(...a),
  objLit: (...kv) => { const o: Record<string, unknown> = {}; for (let i = 0; i < kv.length; i += 2) o[kv[i]] = kv[i + 1]; return o; },
  arrLit: (...a) => a,
  dcall: (f, t, ...a) => { if (typeof f !== "function") throw new TypeError(`${String(f)} is not a function`); return f.apply(t, a); },
};
const notCallable = (f: unknown) => new TypeError(`${String(f)} is not a function`);
/** The same operations at a fixed arity (index = argument count): an import's
 * arity is fixed, so these skip the rest array and the spread call (which also
 * consults Array.prototype[Symbol.iterator]), and the engine's Wasm-to-JS
 * call sees a matching parameter count. Larger arities use ARITY_OPS. */
const FIXED_ARITY_OPS: Record<string, ((...a: any[]) => unknown)[]> = {
  callMethod: [
    (o, k) => o[k](), (o, k, a) => o[k](a), (o, k, a, b) => o[k](a, b), (o, k, a, b, c) => o[k](a, b, c),
    (o, k, a, b, c, d) => o[k](a, b, c, d), (o, k, a, b, c, d, e) => o[k](a, b, c, d, e), (o, k, a, b, c, d, e, g) => o[k](a, b, c, d, e, g),
  ],
  callFn: [
    (f) => f(), (f, a) => f(a), (f, a, b) => f(a, b), (f, a, b, c) => f(a, b, c),
    (f, a, b, c, d) => f(a, b, c, d), (f, a, b, c, d, e) => f(a, b, c, d, e), (f, a, b, c, d, e, g) => f(a, b, c, d, e, g),
  ],
  callFnThis: [
    (f, t) => f.apply(t, []), (f, t, a) => f.apply(t, [a]), (f, t, a, b) => f.apply(t, [a, b]), (f, t, a, b, c) => f.apply(t, [a, b, c]),
    (f, t, a, b, c, d) => f.apply(t, [a, b, c, d]),
  ],
  construct: [
    (C) => new C(), (C, a) => new C(a), (C, a, b) => new C(a, b), (C, a, b, c) => new C(a, b, c), (C, a, b, c, d) => new C(a, b, c, d),
  ],
  dcall: [
    (f, t) => { if (typeof f !== "function") throw notCallable(f); return f.apply(t, []); },
    (f, t, a) => { if (typeof f !== "function") throw notCallable(f); return f.apply(t, [a]); },
    (f, t, a, b) => { if (typeof f !== "function") throw notCallable(f); return f.apply(t, [a, b]); },
    (f, t, a, b, c) => { if (typeof f !== "function") throw notCallable(f); return f.apply(t, [a, b, c]); },
    (f, t, a, b, c, d) => { if (typeof f !== "function") throw notCallable(f); return f.apply(t, [a, b, c, d]); },
    (f, t, a, b, c, d, e) => { if (typeof f !== "function") throw notCallable(f); return f.apply(t, [a, b, c, d, e]); },
    (f, t, a, b, c, d, e, g) => { if (typeof f !== "function") throw notCallable(f); return f.apply(t, [a, b, c, d, e, g]); },
  ],
};

type Op = (...a: any[]) => unknown;
/** A host operation whose result is pre-classified (js.toDyn), at a fixed
 * arity so the Wasm-to-JS call sees a matching parameter count. */
const ENCODED_ARITY: ((f: Op, d: (v: unknown) => unknown) => Op)[] = [
  (f, d) => () => d(f()), (f, d) => (a) => d(f(a)), (f, d) => (a, b) => d(f(a, b)), (f, d) => (a, b, c) => d(f(a, b, c)),
  (f, d) => (a, b, c, e) => d(f(a, b, c, e)), (f, d) => (a, b, c, e, g) => d(f(a, b, c, e, g)),
  (f, d) => (a, b, c, e, g, h) => d(f(a, b, c, e, g, h)), (f, d) => (a, b, c, e, g, h, i) => d(f(a, b, c, e, g, h, i)),
  (f, d) => (a, b, c, e, g, h, i, j) => d(f(a, b, c, e, g, h, i, j)),
];
const encodedAny = (f: Op, d: (v: unknown) => unknown): Op => (...a) => d(f(...a));
/** DOM members the emitter calls through their own host imports instead of
 * the generic keyed operations: `js.dom.<method>.<argc>` for page-value
 * receivers of `recv.<method>(...)` with that argument count,
 * `js.dom.get.<key>` / `js.dom.set.<key>` for constant-key reads and writes
 * of a page value (wasmGcHostImports defines each, with its `@d` twin). The
 * names are React DOM's hot members; any receiver is still exact. */
export const DOM_DIRECT: { methods: Readonly<Record<string, readonly number[]>>; get: readonly string[]; set: readonly string[] } = {
  methods: {appendChild: [1], insertBefore: [2], removeChild: [1], replaceChild: [2], setAttribute: [2], removeAttribute: [1], setAttributeNS: [3], removeAttributeNS: [2], getAttribute: [1], hasAttribute: [1], createElement: [1, 2], createElementNS: [2, 3], createTextNode: [1], createComment: [1], addEventListener: [2, 3], removeEventListener: [2, 3], contains: [1], getRootNode: [0, 1], setProperty: [2, 3], removeProperty: [1], focus: [0, 1], blur: [0]},
  get: ["ownerDocument", "nodeType", "nodeName", "tagName", "namespaceURI", "firstChild", "lastChild", "nextSibling", "previousSibling", "parentNode", "nodeValue", "textContent", "style", "documentElement", "defaultView", "body", "document", "head", "activeElement", "parentElement", "id", "className", "title", "hidden", "tabIndex", "dir", "lang"],
  set: ["textContent", "nodeValue", "onclick", "className", "innerHTML", "value", "checked", "selected", "defaultValue", "defaultChecked", "multiple", "muted", "id", "title", "hidden", "tabIndex", "dir", "lang"],
};
/** The `js.dom.*` import for a DOM member access, or null for the generic
 * operation: kind "call" with the argument count, "get" or "set". */
export function domDirectImport(kind: "call" | "get" | "set", name: string, argc = 0): string | null {
  if (DOM_DIRECT_OFF) return null;
  if (kind === "call") return Object.prototype.hasOwnProperty.call(DOM_DIRECT.methods, name) && DOM_DIRECT.methods[name]!.includes(argc) ? `js.dom.${name}.${argc}` : null;
  return (kind === "get" ? DOM_DIRECT.get : DOM_DIRECT.set).includes(name) ? `js.dom.${kind}.${name}` : null;
}
/** SCRIPTC_WASMGC_DOM_LEGACY=1: DOM members through the generic js.get /
 * js.set / js.callMethod.N (A/B measurement). */
const DOM_DIRECT_OFF = typeof process !== "undefined" && !!(process as { env?: Record<string, string | undefined> }).env?.["SCRIPTC_WASMGC_DOM_LEGACY"];
/** The host bridge contract this file implements (emitter WASMGC_HOST_ABI). */
const HOST_ABI = "scriptc-wasmgc-host/7";
/** The original collection methods (a page that later replaces them does not change how compiled collections cross). */
const mapHas = Map.prototype.has, setHas = Set.prototype.has, mapKeys = Map.prototype.keys, setValues = Set.prototype.values, mapSet = Map.prototype.set, setAdd = Set.prototype.add, mapForEach = Map.prototype.forEach, setForEach = Set.prototype.forEach;
/** A check that the page's array iteration protocol is still the engine's
 * own, or null when it was already replaced before instantiation. It holds
 * while Array.prototype[Symbol.iterator] is the native `values` as a data
 * property, %ArrayIteratorPrototype%.next the native `next` as a data
 * property, and no object on the iterator's prototype chain has an own
 * `return` (so IteratorClose does nothing). Then destructuring an array
 * yields exactly its elements below the current length, which compiled code
 * reads directly. The check reads descriptors, prototypes and own keys of
 * ordinary objects only, so no page getter or Proxy trap runs. Identification
 * at instantiation calls the candidates only once each is shown to be a
 * native function of the right name, so that no page code runs either. */
function pristineArrayIteration(): { pristine: () => boolean; at: (v: object, n: number) => object } | null {
  const gopd = Object.getOwnPropertyDescriptor, protoOf = Object.getPrototypeOf, hasOwn = Object.prototype.hasOwnProperty;
  const fnText = Function.prototype.toString, iter = Symbol.iterator;
  try {
    const arrayProto = protoOf([]) as object, objectProto = protoOf({}) as object;
    const values = gopd(arrayProto, iter)?.value as unknown;
    if (typeof values !== "function" || fnText.call(values) !== "function values() { [native code] }") return null;
    const probe = values.call([7]) as object;
    const iterProto = protoOf(probe) as object, next = gopd(iterProto, "next")?.value as unknown;
    if (typeof next !== "function" || fnText.call(next) !== "function next() { [native code] }") return null;
    const step = gopd(next.call(probe) as object, "value"), last = next.call(probe) as { done?: unknown };
    if (step?.value !== 7 || gopd(last, "done")?.value !== true) return null;
    const baseProto = protoOf(iterProto) as object;
    if (baseProto === null || protoOf(baseProto) !== objectProto) return null;
    return {
      pristine: () => {
        const v = gopd(arrayProto, iter), n = gopd(iterProto, "next");
        return v !== undefined && v.value === values && n !== undefined && n.value === next &&
          protoOf(iterProto) === baseProto && protoOf(baseProto) === objectProto &&
          !hasOwn.call(iterProto, "return") && !hasOwn.call(baseProto, "return") && !hasOwn.call(objectProto, "return");
      },
      // The iterator a for-of opened (while pristine) over v, n steps on. The
      // steps replay over a view that is long enough whatever v's length is
      // now (each step then saw an element), and is v itself afterwards.
      at: (v: object, n: number) => {
        let replay = true;
        const view = new Proxy(v, { get: (t, k, r) => (replay ? (k === "length" ? n + 1 : undefined) : Reflect.get(t, k, r)) });
        const it = values.call(view) as object;
        for (let i = 0; i < n; i++) next.call(it);
        replay = false;
        return it;
      },
    };
  } catch { return null; }
}
/** The same check for another built-in iterable (String, Map, Set): `proto[Symbol.iterator]` and its iterator's
 * `next` are still the engine's own natives, and no `return` is on the iterator's chain; null when they were already
 * replaced before instantiation. Descriptors only, so no page code runs. */
function pristineProtocol(sample: unknown, proto: object): (() => boolean) | null {
  const gopd = Object.getOwnPropertyDescriptor, protoOf = Object.getPrototypeOf, hasOwn = Object.prototype.hasOwnProperty;
  const fnText = Function.prototype.toString, iter = Symbol.iterator, native = /\{ \[native code\] \}$/;
  try {
    const objectProto = protoOf({}) as object;
    const values = gopd(proto, iter)?.value as unknown;
    if (typeof values !== "function" || !native.test(fnText.call(values))) return null;
    const probe = values.call(sample) as object, iterProto = protoOf(probe) as object, next = gopd(iterProto, "next")?.value as unknown;
    if (typeof next !== "function" || !native.test(fnText.call(next))) return null;
    const baseProto = protoOf(iterProto) as object;
    if (baseProto === null || protoOf(baseProto) !== objectProto) return null;
    return () => {
      const v = gopd(proto, iter), n = gopd(iterProto, "next");
      return v !== undefined && v.value === values && n !== undefined && n.value === next &&
        protoOf(iterProto) === baseProto && protoOf(baseProto) === objectProto &&
        !hasOwn.call(iterProto, "return") && !hasOwn.call(baseProto, "return") && !hasOwn.call(objectProto, "return");
    };
  } catch { return null; }
}
/* Realm-independent brands. `instanceof` answers false for a view or buffer made in another realm (an iframe, a
 * Node vm context), and a toStringTag property can be spoofed by a plain object; the engines' own accessors check
 * the internal slots instead: %TypedArray%.prototype[@@toStringTag] answers a typed array's element kind name
 * (undefined for anything else), and SharedArrayBuffer.prototype.byteLength throws unless its receiver is one. */
const typedArrayTag = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!.get!;
/** A typed array's element kind ("Uint8Array", "Float32Array", ...), from any realm; undefined for anything else (a DataView too). */
const viewKind = (v: unknown): string | undefined => typedArrayTag.call(v) as string | undefined;
const sharedByteLength = typeof SharedArrayBuffer !== "undefined" ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")!.get! : undefined;
/** A SharedArrayBuffer (a shared WebAssembly.Memory's buffer), from any realm. */
const isShared = (b: unknown): boolean => {
  if (sharedByteLength === undefined || b === null || typeof b !== "object") return false;
  // This realm's buffers answer by prototype (text.utf8 asks on every decode; a throwing getter is slow); another
  // realm's take the internal-slot check.
  if (b instanceof SharedArrayBuffer) return true;
  if (b instanceof ArrayBuffer) return false;
  try { sharedByteLength.call(b); return true; } catch { return false; }
};
/** A copy of exactly a view's bytes [byteOffset, byteOffset + byteLength) in an ArrayBuffer of its own, as the same
 * kind of view (a DataView stays a DataView, a typed array keeps its element type). */
const copyView = (v: ArrayBufferView): ArrayBufferView => {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
  const kind = viewKind(v);
  if (kind === undefined) return new DataView(bytes.buffer);
  return new (globalThis as unknown as Record<string, new (b: ArrayBuffer) => ArrayBufferView>)[kind]!(bytes.buffer);
};

/** Exact-identity brand for the page wrappers of compiled functions: a JS
 * private field stamped on the wrapper (return-override construction). Unlike
 * a symbol property it is invisible to reflection, is not forwarded by a
 * Proxy, and is not copied by Object.assign; unlike a WeakMap it costs no
 * ephemeron entry per wrapper (React makes ~140 fresh listeners per mount). */
class ReturnOverride { constructor(o: object) { return o; } }
/** The value the next brand's field initializer takes (one define per stamp). */
let stamping: object | undefined;
/** The same private-field brand for page facades of compiled objects/arrays.
 * On a Proxy every private-field operation is a runtime call into the
 * proxy's own property dictionary, so the field is defined with its value
 * (the initializer) instead of being defined and then assigned. `stamping`
 * is set before every use and read only by the initializer, which runs
 * before any other code can, so a throw leaving it set is harmless: no
 * try/finally (it measured about a tenth of a facade's creation). */
/** experimentalDomMirror: a DOM node compiled code created, stamped with
 * its Wasm struct (dom-mirror.ts); invisible to the page as FacadeBrand is. */
class NodeBrand extends ReturnOverride {
  #mirror: object = stamping!;
  private constructor(n: object) { super(n); }
  static stamp(n: object, h: object): void { stamping = h; new NodeBrand(n); stamping = undefined; }
  static of(v: object): object | undefined { return #mirror in v ? (v as NodeBrand).#mirror : undefined; }
}
/** `f.call(self, ...args)` with the original Function.prototype.call (a page replacing it changes nothing here). */
const uncurryThis: (f: Function, self: unknown, ...args: unknown[]) => unknown = Function.prototype.call.bind(Function.prototype.call);
class FacadeBrand extends ReturnOverride {
  #struct: object = stamping!;
  private constructor(p: object) { super(p); }
  static stamp(p: object, struct: object): void { stamping = struct; new FacadeBrand(p); stamping = undefined; }
  static structOf(v: object): object | undefined { return #struct in v ? (v as FacadeBrand).#struct : undefined; }
}
/** A native-dyn facade's Proxy target, carrying the facade's compiled
 * reference and its Proxy as private fields: invisible to reflection and to
 * the Proxy invariants. An object facade's target is a fresh instance of
 * this class (a plain construction, measured about a fifth of a facade's
 * creation faster than stamping a `{}`): only symbol keys ever reach a
 * target or its prototype chain, and neither this class's prototype nor
 * ReturnOverride's carries one, so it answers every trap as `{}` would. An
 * array facade's target is `[]` stamped in place (Array.isArray holds). */
class DynTarget extends ReturnOverride {
  #ref: object;
  #proxy: object | null = null;
  private constructor(t: object | undefined, ref: object) { super(t as object); this.#ref = ref; }
  static make(t: object | undefined, ref: object): object { return new DynTarget(t, ref); }
  static ref(t: object): object { return (t as DynTarget).#ref; }
  static proxy(t: object): object | null { return (t as DynTarget).#proxy; }
  static setProxy(t: object, p: object): void { (t as DynTarget).#proxy = p; }
}
/** A record facade's Proxy target: the struct, the Proxy and whether
 * JavaScript reshaped it (adopted: the fields then live on the target). */
class RecordTarget extends ReturnOverride {
  #struct: object = stamping!;
  #proxy: object | null = null;
  #adopted = false;
  private constructor(t: object) { super(t); }
  static make<T extends object>(t: T, struct: object): T { stamping = struct; try { new RecordTarget(t); } finally { stamping = undefined; } return t; }
  static struct(t: object): object { return (t as RecordTarget).#struct; }
  static proxy(t: object): object | null { return (t as RecordTarget).#proxy; }
  static setProxy(t: object, p: object): void { (t as RecordTarget).#proxy = p; }
  static adopted(t: object): boolean { return (t as RecordTarget).#adopted; }
  static setAdopted(t: object): void { (t as RecordTarget).#adopted = true; }
}
class ClosureBrand extends ReturnOverride {
  #closure: object;
  private constructor(f: object, closure: object) { super(f); this.#closure = closure; }
  static stamp(f: object, closure: object): void { new ClosureBrand(f, closure); }
  static closureOf(v: object): object | undefined { return #closure in v ? (v as ClosureBrand).#closure : undefined; }
}

/** What the page offers for the shared-memory deployment (owner direction,
 * review §19: COI is a hard requirement). */
export interface DeploymentCapabilities {
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  atomics: boolean;
  /** `Atomics.waitAsync`: nonblocking waits on the UI thread (window agents
   * cannot block in Atomics.wait). */
  atomicsWaitAsync: boolean;
  sharedWasmMemory: boolean;
  /** Growable shared memory views: `memory.toResizableBuffer()` on a shared
   * memory gives a growable SharedArrayBuffer whose length-tracking views
   * follow `memory.grow` (checked by behavior). */
  growableSharedViews: boolean;
  /** JSPI (`WebAssembly.Suspending` / `WebAssembly.promising`, review §21.4):
   * presence only; tests/wasmgc-coi runs the execution probe. */
  jspi: boolean;
}
export function deploymentCapabilities(): DeploymentCapabilities {
  const g = globalThis as any, W = g.WebAssembly;
  let sharedWasmMemory = false, growableSharedViews = false;
  try {
    const mem = new W.Memory({ initial: 1, maximum: 2, shared: true });
    sharedWasmMemory = typeof SharedArrayBuffer !== "undefined" && mem.buffer instanceof SharedArrayBuffer;
    // Behavior, not method presence (review §22.3 G): the shipped method is
    // toResizableBuffer(), which on a shared memory returns a growable
    // SharedArrayBuffer; a length-tracking view over it must see growth.
    if (sharedWasmMemory && typeof mem.toResizableBuffer === "function") {
      const buf = mem.toResizableBuffer();
      const view = new Uint8Array(buf);
      const before = view.length;
      mem.grow(1);
      growableSharedViews = buf instanceof SharedArrayBuffer && (buf as { growable?: boolean }).growable === true && before === 65536 && view.length === 131072;
    }
  } catch { /* not available */ }
  return {
    crossOriginIsolated: g.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer === "function",
    atomics: typeof g.Atomics === "object",
    atomicsWaitAsync: typeof g.Atomics?.waitAsync === "function",
    sharedWasmMemory,
    growableSharedViews,
    jspi: typeof (W as unknown as { Suspending?: unknown }).Suspending === "function" && typeof (W as unknown as { promising?: unknown }).promising === "function",
  };
}
/** The WASI preview-1 environment a threaded Rust module (target
 * wasm32-wasip1-threads: std built with atomics) imports. The host chooses
 * it (review §19): no environment variables, output lines to `log`
 * (stdout/stderr by fd), proc_exit as an exception, sched_yield a no-op,
 * clocks from performance, and thread-spawn through the given spawner.
 * Anything else the module imports is a link error, not a silent stub. */
export function wasiThreadsEnvironment(memory: { buffer: ArrayBufferLike }, log: (fd: number, text: string) => void = (fd, t) => (fd === 2 ? console.error : console.log)(t),
  /** wasi-threads `thread-spawn`: start a worker that instantiates the same
   * module on this memory and calls wasi_thread_start(tid, startArg); return
   * the new thread id (> 0) or a negative errno. Absent: spawning fails. */
  spawn?: (startArg: number) => number): Record<string, Record<string, unknown>> {
  const dv = () => new DataView(memory.buffer as ArrayBuffer);
  const pending: Record<number, string> = {};
  const decoder = new TextDecoder();
  return {
    wasi_snapshot_preview1: {
      // Pointers arrive as wasm i32 (signed): `>>> 0` reads one past 2 GiB as the address it is.
      environ_sizes_get: (countPtr: number, sizePtr: number) => { dv().setUint32(countPtr >>> 0, 0, true); dv().setUint32(sizePtr >>> 0, 0, true); return 0; },
      environ_get: () => 0,
      fd_write: (fd: number, iovs: number, count: number, writtenPtr: number) => {
        iovs >>>= 0;
        writtenPtr >>>= 0;
        if (fd !== 1 && fd !== 2) return 8; // EBADF
        const view = dv();
        let text = "", written = 0;
        for (let i = 0; i < count; i++) {
          const ptr = view.getUint32(iovs + i * 8, true), len = view.getUint32(iovs + i * 8 + 4, true);
          // decode() refuses shared views: copy the bytes out first.
          text += decoder.decode(new Uint8Array(memory.buffer as ArrayBuffer, ptr, len).slice());
          written += len;
        }
        const lines = ((pending[fd] ?? "") + text).split("\n");
        pending[fd] = lines.pop()!;
        for (const line of lines) log(fd, line);
        view.setUint32(writtenPtr, written, true);
        return 0;
      },
      proc_exit: (code: number) => { throw new Error(`Rust called proc_exit(${code})`); },
      sched_yield: () => 0,
      // Clock 0 is realtime, the rest monotonic; nanoseconds as a u64.
      clock_time_get: (id: number, _precision: bigint, outPtr: number) => {
        const perf = (globalThis as unknown as { performance: { now(): number; timeOrigin: number } }).performance;
        const ms = id === 0 ? perf.timeOrigin + perf.now() : perf.now();
        dv().setBigUint64(outPtr >>> 0, BigInt(Math.round(ms * 1e6)), true);
        return 0;
      },
    },
    wasi: { "thread-spawn": (startArg: number) => (spawn ? spawn(startArg) : -6 /* EAGAIN */) },
  };
}

/** Refuse to start without the hard deployment requirements: an actionable
 * error naming what is missing and how to provide it. */
export function requireDeploymentCapabilities(required: (keyof DeploymentCapabilities)[] = ["crossOriginIsolated", "sharedArrayBuffer", "atomics", "atomicsWaitAsync", "sharedWasmMemory"]): DeploymentCapabilities {
  const caps = deploymentCapabilities();
  const missing = required.filter((k) => !caps[k]);
  if (missing.length) {
    const hint = !caps.crossOriginIsolated
      ? " The page is not cross-origin isolated: serve the document (and every frame/worker in the embedding) with \"Cross-Origin-Opener-Policy: same-origin\" and \"Cross-Origin-Embedder-Policy: require-corp\" (subresources need CORP/CORS), over HTTPS or localhost."
      : " This browser lacks a required shared-memory feature; see docs/WASMGC_RELEASE_CONTRACT.md for the supported runtime floor.";
    throw new Error(`this application requires ${missing.join(", ")}.${hint}`);
  }
  return caps;
}


/** NATIVE_SIM, a module that exports hostStringType (hostHandles): the native host owns its strings as GC arrays,
 * $HostString = (array (mut i16)), and implements wasm:js-string over them. This models it: a small helper module
 * (built here, never shipped) converts between JS strings and $HostString arrays; the compiled module is
 * instantiated WITHOUT engine builtins against JS implementations of wasm:js-string that accept both forms and
 * answer host strings; every host import normalizes host-string arguments to JS strings and answers its string
 * results as host strings; exports normalize their results. A compiled test that mistakes a host string for a
 * compiled value then fails visibly. */
interface HostStringModel { fromJs(s: string): unknown; toJs(a: unknown): string; isHost(a: unknown): boolean;
  builtins: Record<string, Function>; wrapHost(host: Record<string, unknown>): void; wrapExports(view: Record<string, unknown>): void }
async function hostStringModel(): Promise<HostStringModel> {
  // The helper's binary, emitted once by binaryen from this text (kept here as its source). Embedded rather than built
  // at run time, so nothing that bundles this host (the native host's JS harness, a page) pulls in binaryen.
  // (module
  //  (rec (type $H (struct (field (ref extern)) (field (mut anyref)))) (type $S (array (mut i16))))
  //  (func (export "mk") (param $n i32) (result externref) (extern.convert_any (array.new_default $S (local.get $n))))
  //  (func (export "set") (param $x externref) (param $i i32) (param $c i32) (array.set $S (ref.cast (ref $S) (any.convert_extern (local.get $x))) (local.get $i) (local.get $c)))
  //  (func (export "len") (param $x externref) (result i32) (array.len (ref.cast (ref $S) (any.convert_extern (local.get $x)))))
  //  (func (export "at") (param $x externref) (param $i i32) (result i32) (array.get_u $S (ref.cast (ref $S) (any.convert_extern (local.get $x))) (local.get $i)))
  //  (func (export "isHost") (param $x externref) (result i32) (ref.test (ref $S) (any.convert_extern (local.get $x)))))
  const bytes = Uint8Array.from(atob("AGFzbQEAAAABIwVOAl8CZG8AbgFedwFgAX8Bb2ADb39/AGABbwF/YAJvfwF/AwYFAgMEBQQHIAUCbWsAAANzZXQAAQNsZW4AAgJhdAADBmlzSG9zdAAECkEFCQAgAPsHAfsbCxAAIAD7GvsWASABIAL7DgELCwAgAPsa+xYB+w8LDgAgAPsa+xYBIAH7DQELCQAgAPsa+xQBCw=="), (c) => c.charCodeAt(0));
  const helperModule = await engine.compile(bytes, {});
  const h = (await engine.instantiate(helperModule, {})).exports as Record<string, any>;
  const isHost = (a: unknown): boolean => (typeof a === "object" || typeof a === "function") && a !== null && h["isHost"](a) === 1;
  const toJs = (a: unknown): string => { const n = h["len"](a) as number; let out = ""; for (let i = 0; i < n; i += 4096) { const part: number[] = []; for (let j = i; j < Math.min(n, i + 4096); j++) part.push(h["at"](a, j)); out += String.fromCharCode(...part); } return out; };
  const norm = (a: unknown): unknown => isHost(a) ? toJs(a) : a;
  const fromJs = (s: string): unknown => { const a = h["mk"](s.length); for (let i = 0; i < s.length; i++) h["set"](a, i, s.charCodeAt(i)); return a; };
  const trap = (msg: string): never => { throw new (engine as any).RuntimeError(msg); };
  const str = (a: unknown): string => { const v = norm(a); if (typeof v !== "string") trap("not a string"); return v as string; };
  const builtins: Record<string, Function> = {
    cast: (a: unknown) => { if (typeof a !== "string" && !isHost(a)) trap("illegal cast"); return a; },
    test: (a: unknown) => (typeof a === "string" || isHost(a) ? 1 : 0),
    length: (a: unknown) => str(a).length,
    charCodeAt: (a: unknown, i: number) => { const s = str(a); if (i >>> 0 >= s.length) trap("index out of bounds"); return s.charCodeAt(i); },
    codePointAt: (a: unknown, i: number) => { const s = str(a); if (i >>> 0 >= s.length) trap("index out of bounds"); return s.codePointAt(i); },
    concat: (a: unknown, b: unknown) => fromJs(str(a) + str(b)),
    substring: (a: unknown, start: number, end: number) => { const s = str(a); start = start >>> 0; end = end >>> 0; if (start > s.length || start > end) return fromJs(""); return fromJs(s.substring(start, Math.min(end, s.length))); },
    equals: (a: unknown, b: unknown) => (a === null || b === null ? (a === b ? 1 : 0) : str(a) === str(b) ? 1 : 0),
    compare: (a: unknown, b: unknown) => { const x = str(a), y = str(b); return x < y ? -1 : x > y ? 1 : 0; },
    fromCodePoint: (cp: number) => { if (cp >>> 0 > 0x10ffff) trap("invalid code point"); return fromJs(String.fromCodePoint(cp)); },
    fromCharCode: (c: number) => fromJs(String.fromCharCode(c)),
  };
  const wrapFn = (f: Function) => function (this: unknown, ...args: unknown[]) {
    const r = f.apply(this, args.map(norm));
    return typeof r === "string" ? fromJs(r) : r;
  };
  return { fromJs, toJs, isHost, builtins,
    wrapHost(host) { for (const k of Object.keys(host)) if (typeof host[k] === "function") host[k] = wrapFn(host[k] as Function); },
    wrapExports(view) { for (const k of Object.keys(view)) { const f = view[k]; if (typeof f === "function") view[k] = function (this: unknown, ...a: unknown[]) { return norm(f.apply(this, a)); }; } } };
}

export async function instantiateWasmGc(binary: Uint8Array, opts: WasmGcHostOptions = {}): Promise<WasmGcInstance> {
  const linked = await instantiateLinked(binary, { "": opts });
  return { ...linked.modules[""]!, instance: linked.instance, capabilities: linked.capabilities };
}

/** What an instance needed, what the engine offered, and each fallback the host took (`strings:constants`,
 * `strings:polyfill`). `required` is null for a module built before capabilities were recorded. */
export interface WasmGcInstanceCapabilities {
  required: ResolvedCapabilities | null;
  provided: EngineCapabilities;
  fallbacks: string[];
}

export interface WasmGcLinkedInstance {
  instance: { exports: Record<string, unknown> };
  capabilities: WasmGcInstanceCapabilities;
  /** Each compiled module by its link namespace ("" for an unlinked module). */
  modules: Record<string, Omit<WasmGcInstance, "instance" | "capabilities"> & { exports: Record<string, unknown> }>;
}

/**
 * The options instantiateLinked compiles a binary with: JS String Builtins, and the string constants from "'" --
 * each import's name is its text -- unless the environment supplies module "'" itself (`suppliedStrings`: a release
 * that renamed its string constants to opaque ids and carries the text elsewhere), when the constants are ordinary
 * imports. A caller that compiles the module itself (compileStreaming, so the engine can cache its code) compiles
 * with these and hands instantiateLinked the module.
 */
export function linkedCompileOptions(suppliedStrings: boolean): { builtins: string[]; importedStringConstants?: string } {
  return suppliedStrings ? { builtins: ["js-string"] } : { builtins: ["js-string"], importedStringConstants: "'" };
}

/** A release's own names for its host imports (an opaque bindings pass): instantiateLinked resolves every import by
 * its logical name, as if the module had imported it under that name, then serves it under the module's own. */
export interface WasmGcImportBindings {
  /** The logical [module, name] an import stands for, or undefined for an import named as itself. */
  logical(module: string, name: string): readonly [string, string] | undefined;
  /** Logical host imports the module does not import under any name (operations it reaches through an entry of the
   * bindings' own), resolved all the same. */
  resolved?: readonly (readonly [string, string])[];
  /** Called once every logical import is resolved, to add the imports the bindings serve themselves. */
  bind?(resolve: (module: string, name: string) => unknown, all: Record<string, Record<string, unknown>>): void;
}

/** Instantiate a binary holding one or more compiled modules (merged with
 * other wasm such as a Rust kernel). Each namespace gets its own host imports
 * (`ns:host`) and state, and sees its own exports with the `ns.` prefix
 * stripped. `imports` supplies any further import modules the binary needs.
 * `binary` may be the module already compiled with linkedCompileOptions. */
export async function instantiateLinked(binary: Uint8Array | object, namespaces: Record<string, WasmGcHostOptions>,
  imports: Record<string, Record<string, unknown>> = {}, bindings?: WasmGcImportBindings): Promise<WasmGcLinkedInstance> {
  const suppliedStrings = imports["'"] !== undefined;
  const stringConstants = suppliedStrings ? {} : { importedStringConstants: "'" };
  const bytes = binary instanceof Uint8Array ? binary : null;
  const allOpts = Object.values(namespaces);
  const strict = allOpts.some(o => o.capabilities === "strict");
  const stringsMode = allOpts.find(o => o.strings !== undefined)?.strings ?? (strict ? "engine" : "auto");
  const compileOptions = stringsMode === "polyfill" ? {} : stringsMode === "constants" ? { builtins: ["js-string"] } : linkedCompileOptions(suppliedStrings);
  let module: object;
  try {
    module = bytes ? await engine.compile(bytes, compileOptions) : binary;
  } catch (e) {
    // A module this engine cannot compile: name the capability it lacks, when the module records what it requires.
    const record = bytes ? decodeCapabilitySection(readCustomSections(bytes, CAPABILITY_SECTION)[0] ?? new Uint8Array()) : null;
    const missing = record ? missingRequirements(record.requires) : [];
    if (missing.length) throw new Error(`this module requires ${refusalText(missing)}; this engine lacks it`, { cause: e });
    throw e;
  }
  const required = ((): ResolvedCapabilities | null => {
    const section = engine.Module.customSections?.(module, CAPABILITY_SECTION)?.[0];
    return section ? decodeCapabilitySection(section) : null;
  })();
  const provided = detectCapabilities();
  const fallbacks: string[] = [];
  if (required) {
    // A memory the environment supplies shared never detaches: no resizable buffers needed.
    const suppliedSharedMemory = Object.values(imports).some(n => Object.values(n).some(v => isShared((v as { buffer?: unknown } | null)?.buffer)));
    const missing = missingRequirements(required.requires.filter(r => !(suppliedSharedMemory && r === "resizable-memory-buffer")), provided);
    if (missing.length) throw new Error(`this module requires ${refusalText(missing)}; this engine lacks it`);
  }
  const fixedMemory = required !== null && fixedMiB(required.mode.views) !== null;
  let hostStrings: HostStringModel | null = null;
  if (NATIVE_SIM && ((engine as any).Module.exports(module) as { name: string }[]).some(e => e.name === "hostStringType")) {
    if (!bytes) throw new Error("the native string model recompiles its binary: pass the bytes, not a module");
    hostStrings = await hostStringModel();
    module = await engine.compile(bytes, stringConstants);
  }
  const all: Record<string, Record<string, unknown>> = { ...imports };
  if (hostStrings) all["wasm:js-string"] = hostStrings.builtins;
  // Strings the engine did not supply itself are still listed as imports: serve them from plain JavaScript.
  {
    const listed = engine.Module.imports(module);
    const constants = listed.filter(i => i.module === "'");
    if (constants.length && all["'"] === undefined) {
      if (stringsMode === "engine") throw new Error(`this module requires ${refusalText(["imported-string-constants"])}; this engine lacks it (strict capabilities refuse the plain-JavaScript fallback)`);
      all["'"] = Object.fromEntries(constants.map(i => [i.name, i.name]));
      fallbacks.push("strings:constants");
    }
    if (listed.some(i => i.module === "wasm:js-string") && all["wasm:js-string"] === undefined) {
      if (stringsMode === "engine") throw new Error(`this module requires ${refusalText(["js-string-builtins"])}; this engine lacks it (strict capabilities refuse the plain-JavaScript fallback)`);
      all["wasm:js-string"] = jsStringPolyfill;
      fallbacks.push("strings:polyfill");
    }
  }
  // Host modules supplied through the options (`modules`, keyed by specifier) serve typed host-module imports too.
  for (const opts of Object.values(namespaces)) for (const [spec, supplied] of Object.entries(opts.modules ?? {})) if (all[spec] === undefined && typeof supplied === "object" && supplied !== null) all[spec] = supplied;
  const states = new Map<string, WasmGcHostState>();
  const hostModuleOf = (ns: string) => (ns ? `${ns}:host` : "host");
  for (const [ns, opts] of Object.entries(namespaces)) {
    const state: WasmGcHostState = fixedMemory ? { fixedMemory: true } : {};
    states.set(ns, state);
    // Overrides go onto the host object itself: its own operations read later entries from it.
    all[hostModuleOf(ns)] = Object.assign((wasmGcHostImports(opts, state) as Record<string, Record<string, unknown>>)["host"]!, opts.hostOverrides);
  }
  // What the module imports, by logical name: under bindings, an opaque import reads as the one it stands for.
  const physicalImports = engine.Module.imports(module);
  const moduleImports = bindings ? [
    ...physicalImports.map(i => { const l = bindings.logical(i.module, i.name); return l ? { ...i, module: l[0], name: l[1] } : i; }),
    ...(bindings.resolved ?? []).map(([m, n]) => ({ module: m, name: n, kind: "function" })),
  ] : physicalImports;
  // Per-arity island operations (js.callMethod.N, js.objLit.N, ...) are
  // synthesised from what the module imports.
  for (const { module: mod, name } of moduleImports) {
    const host = all[mod];
    if (!host || !states.has(mod === "host" ? "" : mod.replace(/:host$/, "")) || host[name]) continue;
    const arityOp = (op: string) => {
      const match = /^js\.(callMethod|callFn|callFnThis|construct|objLit|arrLit|dcall)\.(\d+)$/.exec(op);
      return match ? FIXED_ARITY_OPS[match[1]!]?.[Number(match[2])] ?? ARITY_OPS[match[1]!] : undefined;
    };
    // `<name>@d<arity>`: <name> with its result pre-classified (js.toDyn).
    // `js.global.<name>`: a typed read of one page global (host-ABI §7).
    const pageGlobalRead = (op: string): (() => unknown) | undefined => {
      const global = /^js\.global\.(.+)$/.exec(op);
      if (!global) return undefined;
      const key = global[1]!;
      // NATIVE_SIM: the native host has no page ECMAScript builtins to read (host-ABI §7 answers null); compiled code must not ask.
      if (NATIVE_SIM && NATIVE_ABSENT_GLOBALS.has(key)) return () => undefined;
      return () => (globalThis as Record<string, unknown>)[key];
    };
    const pre = /^(.+)@d(\d+)$/.exec(name);
    if (pre) {
      const base = (host[pre[1]!] ?? arityOp(pre[1]!) ?? pageGlobalRead(pre[1]!)) as ((...a: unknown[]) => unknown) | undefined;
      if (base) host[name] = (ENCODED_ARITY[Number(pre[2])] ?? encodedAny)(base, host["js.toDyn"] as (v: unknown) => unknown);
      continue;
    }
    // `js.typeofGlobal.<name>`: typeof of one page global, answered without reading its value across (an absent global is "undefined").
    const typeofGlobal = /^js\.typeofGlobal\.(.+)$/.exec(name);
    if (typeofGlobal) {
      const key = typeofGlobal[1]!;
      host[name] = () => typeof (globalThis as Record<string, unknown>)[key];
      continue;
    }
    const globalRead = pageGlobalRead(name);
    if (globalRead) {
      host[name] = globalRead;
      continue;
    }
    const op = arityOp(name);
    if (op) host[name] = NATIVE_SIM && /^js\.callMethod\./.test(name) ? function (this: unknown, o: unknown, k: unknown) {
      if (isPrimitiveReceiver(o)) throw new TypeError(`Cannot call '${String(k)}' on a primitive: not a host object (${name})`);
      return Reflect.apply(op as (...a: any[]) => unknown, this, arguments as unknown as ArrayLike<unknown>);
    } : op;
  }
  if (hostStrings) for (const ns of states.keys()) hostStrings.wrapHost(all[hostModuleOf(ns)]!);
  // Each opaque import is served the value of the import it stands for; a logical name nothing resolves is refused
  // here, by its opaque name only.
  if (bindings) {
    for (const i of physicalImports) {
      const l = bindings.logical(i.module, i.name);
      if (!l) continue;
      const value = all[l[0]]?.[l[1]];
      if (value === undefined) throw new Error(`this module imports ${i.module}.${i.name}, which its bindings name but no host serves`);
      (all[i.module] ??= {})[i.name] = value;
    }
    bindings.bind?.((m, n) => all[m]?.[n], all);
  }
  // Host-ABI compatibility: a module records the bridge contract it was built
  // against (custom section scriptc.host-abi); a different one is refused here
  // instead of misbehaving at its first mismatched import. Modules without
  // the section predate the check and are accepted.
  for (const section of engine.Module.customSections?.(module, "scriptc.host-abi") ?? []) {
    const abi = new TextDecoder().decode(section);
    if (abi !== HOST_ABI) throw new Error(`this module was built for host ABI "${abi}", but this host implements "${HOST_ABI}": rebuild the module with the matching compiler`);
  }
  // Declared capability: byte views handed to the page alias module memory and
  // must survive memory.grow, which needs WebAssembly.Memory.prototype
  // .toResizableBuffer. Without it a retained view would silently detach, so
  // the configuration is refused up front. A shared memory supplied by the
  // environment never detaches, and neither does a fixed memory
  // (views=fixed): no requirement. (A module recording its capabilities was
  // checked above; this covers older modules.)
  const memoryProto = (engine as unknown as { Memory?: { prototype?: object } }).Memory?.prototype as { toResizableBuffer?: unknown } | undefined;
  const suppliedShared = Object.values(imports).some(ns => Object.values(ns).some(v => isShared((v as { buffer?: unknown } | null)?.buffer)));
  if (!suppliedShared && !fixedMemory && moduleImports.some(i => i.name === "bytes.toJs") && typeof memoryProto?.toResizableBuffer !== "function")
    throw new Error(`this module hands byte views to the page, which requires WebAssembly.Memory.prototype.toResizableBuffer (${supportText("resizable-memory-buffer")}); this host lacks it. Under Node 24 or 25 run with --experimental-wasm-rab-integration, or build with --capabilities views=fixed:<MiB>`);
  // JSPI (review §21.4): every function the module imports from "jspi" is a
  // suspending import (it may return a Promise; the wasm stack suspends until
  // it settles); every `$promising.<name>` export is a promising entry.
  const W = engine as unknown as { Suspending?: new (f: Function) => unknown; promising?: (f: Function) => Function };
  const jspiImports = engine.Module.imports(module).filter(i => i.module === "jspi");
  if (jspiImports.length) {
    if (typeof W.Suspending !== "function" || typeof W.promising !== "function")
      throw new Error(`this module suspends on host promises, which requires JSPI (WebAssembly.Suspending / WebAssembly.promising: ${supportText("jspi")}); this host lacks it`);
    const given = imports["jspi"] ?? {};
    const wrapped: Record<string, unknown> = {};
    for (const { name } of jspiImports) {
      if (typeof given[name] !== "function") throw new Error(`this module suspends on jspi.${name}; supply it in the imports`);
      wrapped[name] = new W.Suspending(given[name] as Function);
    }
    all["jspi"] = wrapped;
  }
  // Typed host modules (HOST_IMPORT_ABI section 7): a plain-JS implementation supplied under the specifier is adapted to the signatures the
  // module records. Synchronous functions pass through with the boolean conversions; a Promise-returning function takes the compiled promise
  // as a trailing `target` and is settled here through the instance's jsSettleI32 / jsSettleF64 / jsSettle exports.
  let linkedInstance: { exports: Record<string, unknown> } | undefined;
  const adaptedModules = new Map<string, Record<string, unknown>>();
  for (const section of engine.Module.customSections?.(module, "scriptc.host-modules") ?? []) {
    const record = JSON.parse(new TextDecoder().decode(section)) as { namespace: string; modules: { module: string; name: string; params: string[]; result: string }[] };
    const prefix = record.namespace ? `${record.namespace}.` : "";
    const exportOf = (name: string): ((...a: unknown[]) => void) => {
      const f = linkedInstance?.exports[prefix + name];
      if (typeof f !== "function") throw new Error(`the host module settle export ${prefix}${name} is missing`);
      return f as (...a: unknown[]) => void;
    };
    // A callback parameter (`callback:<export>:<param kinds>:<result kind>`): the compiled closure arrives as a reference and the host gets a
    // function that calls it through the trampoline export, its arguments converted to the declared kinds. One function per closure, so a
    // host that compares callbacks by identity (a listener set) sees the same function for the same closure.
    const callbacks = new Map<string, WeakMap<object, Function>>();
    const callbackOf = (p: string, ref: object): Function => {
      let byRef = callbacks.get(p);
      if (byRef === undefined) { byRef = new WeakMap(); callbacks.set(p, byRef); }
      const known = byRef.get(ref);
      if (known !== undefined) return known;
      const [, exp, kindList, ret] = p.split(":") as [string, string, string, string];
      const kinds = kindList === "" ? [] : kindList.split(",");
      const trampoline = exportOf(exp) as unknown as (...a: unknown[]) => unknown;
      const conv = kinds.map((k) => k === "boolean" ? (x: unknown) => (x ? 1 : 0) : k === "number" ? (x: unknown) => Number(x) : k === "string" ? (x: unknown) => String(x) : (x: unknown) => x);
      const fn = ret === "boolean"
        ? (...xs: unknown[]) => trampoline(ref, ...conv.map((c, i) => c(xs[i]))) !== 0
        : ret === "void" ? (...xs: unknown[]) => { trampoline(ref, ...conv.map((c, i) => c(xs[i]))); }
        : (...xs: unknown[]) => trampoline(ref, ...conv.map((c, i) => c(xs[i])));
      byRef.set(ref, fn);
      return fn;
    };
    for (const decl of record.modules) {
      const supplied = all[decl.module];
      const impl = supplied?.[decl.name];
      if (typeof impl !== "function") throw new Error(`this module imports ${decl.module}.${decl.name}; supply a function for it in the imports under "${decl.module}"`);
      let adapted = adaptedModules.get(decl.module);
      if (adapted === undefined) { adapted = { ...supplied! }; adaptedModules.set(decl.module, adapted); all[decl.module] = adapted; }
      const convertIn = (args: unknown[]): unknown[] => args.map((a, i) => {
        const p = decl.params[i]!;
        return p === "boolean" ? a !== 0 : p.startsWith("callback:") ? callbackOf(p, a as object) : a;
      });
      const promised = /^promise<(.+)>$/.exec(decl.result);
      if (promised === null) {
        const convertOut = decl.result === "boolean" ? (r: unknown) => (r ? 1 : 0) : decl.result === "void" ? () => undefined : (r: unknown) => r;
        adapted[decl.name] = (...args: unknown[]) => convertOut((impl as Function)(...convertIn(args)));
        continue;
      }
      const kind = promised[1]!;
      adapted[decl.name] = (...args: unknown[]) => {
        const target = args[args.length - 1];
        const reject = (e: unknown) => exportOf("jsSettle")(target, e, 1);
        let result: unknown;
        try { result = (impl as Function)(...convertIn(args.slice(0, -1))); } catch (e) { reject(e); return; }
        Promise.resolve(result).then((v) => {
          if (kind === "boolean") exportOf("jsSettleI32")(target, v ? 1 : 0);
          else if (kind === "number") exportOf("jsSettleF64")(target, Number(v));
          else if (kind === "string") exportOf("jsSettleStr")(target, String(v));
          else exportOf("jsSettle")(target, kind === "void" ? null : v, 0);
        }, reject);
      };
    }
  }
  // Dev measurement, opt-in: a Map on globalThis.__scriptcHostCalls when the module is instantiated counts every call into
  // a host module (`ns:host`, and the typed host modules as adapted above), keyed "<module> <name>". Absent, nothing is wrapped.
  const hostCalls = (globalThis as { __scriptcHostCalls?: unknown }).__scriptcHostCalls;
  const stacks = (globalThis as { __scriptcHostStacks?: unknown }).__scriptcHostStacks;
  if (hostCalls instanceof Map) {
    const counted = new Set([...states.keys()].map(hostModuleOf).concat([...adaptedModules.keys()]));
    for (const mod of counted) {
      const served = all[mod];
      if (!served) continue;
      const wrapped: Record<string, unknown> = {};
      for (const [name, fn] of Object.entries(served)) {
        if (typeof fn !== "function") { wrapped[name] = fn; continue; }
        const key = `${mod} ${name}`;
        wrapped[name] = function (this: unknown, ...args: unknown[]) {
          const n = (hostCalls.get(key) ?? 0) + 1;
          hostCalls.set(key, n);
          // A second Map on globalThis.__scriptcHostStacks also keeps the calling stack of every 257th call, keyed "<module> <name>\n<frames>".
          if (stacks instanceof Map && n % 257 === 0) { const at = `${key}\n${new Error().stack?.split("\n").slice(2, 8).map(l => l.trim()).join("\n")}`; stacks.set(at, (stacks.get(at) ?? 0) + 1); }
          return fn.apply(this, args);
        };
      }
      all[mod] = wrapped;
    }
  }
  const instance = await engine.instantiate(module, all);
  linkedInstance = instance as unknown as { exports: Record<string, unknown> };
  const modules: WasmGcLinkedInstance["modules"] = {};
  // Promising entries are serialized per INSTANCE (every export of every
  // namespace in this binary shares one queue): the modules share memory and
  // state, and a suspended invocation interleaving with another is not yet
  // shown safe. Admission is bounded; a rejected call frees its place.
  const limit = Math.min(64, ...Object.values(namespaces).map(o => o.promisingLimit ?? 64));
  let tail: Promise<unknown> = Promise.resolve(), admitted = 0;
  const admit = (entry: Function, name: string) => (...args: unknown[]): Promise<unknown> => {
    if (admitted >= limit) return Promise.reject(new Error(`busy: ${admitted} promising calls are already admitted (limit ${limit}); ${name} was not started`));
    admitted++;
    const run = tail.then(() => entry(...args));
    tail = run.then(() => { admitted--; }, () => { admitted--; });
    return run;
  };
  for (const [ns, state] of states) {
    // This module's exports, prefix stripped; shared ones (a linked memory) stay visible.
    const prefix = ns ? `${ns}.` : "";
    const view: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(instance.exports)) if (!prefix || k.startsWith(prefix)) view[k.slice(prefix.length)] = v;
    if (hostStrings) hostStrings.wrapExports(view);
    // Promising entries return a Promise, through the instance's queue.
    for (const k of Object.keys(view)) {
      if (!k.startsWith("$promising.")) continue;
      const name = k.slice("$promising.".length);
      view[name] = admit(W.promising!(view[k] as Function), name);
      delete view[k];
    }
    if (!view["memory"] && instance.exports["memory"]) view["memory"] = instance.exports["memory"];
    state.exports = view;
    if (view["drain"]) state.drain = view["drain"] as () => void;
    if (view["reportUnhandled"]) state.reportUnhandled = view["reportUnhandled"] as () => void;
    if (view["memory"]) state.memory = view["memory"] as { buffer: ArrayBuffer };
    // An imported memory the module does not re-export: the one supplied.
    const memImport = engine.Module.imports(module).find(i => i.kind === "memory");
    const supplied = memImport && all[memImport.module]?.[memImport.name] as { buffer: ArrayBuffer } | undefined;
    if (!state.memory && supplied) state.memory = supplied;
    if (view["bytesFree"]) state.bytesFree = view["bytesFree"] as (base: number) => void;
    if (view["timerFire"]) state.timerFire = view["timerFire"] as (slot: number, repeat: number) => void;
    // A module with top-level await settles later: main returns its
    // evaluation promise (rejecting with the thrown value, opaque to JS).
    const usesTla = moduleImports.some(i => i.module === hostModuleOf(ns) && i.name === "async.moduleDone");
    const main = (): void | Promise<void> => {
      if (!usesTla) return (view["main"] as () => void)();
      const done = new Promise<void>((resolve, reject) => { state.moduleDone = (rejected, value) => rejected ? reject(value) : resolve(); });
      (view["main"] as () => void)();
      return done;
    };
    modules[ns] = { exports: view, main, stopTimers: () => state.stopTimers?.(), pendingTimers: () => { let n = 0; for (const t of state.timers?.values() ?? []) if (t.ref) n++; return n; } };
  }
  // Discrete library compilation (WasmGcLink.sharedRuntime): every module's
  // $rt.link, in link order, before any module's main. It registers the
  // module's typed-value dispatchers with the shared runtime and checks that
  // a client's compile-time atoms still take the ids it was compiled with.
  for (const [ns, mod] of Object.entries(modules)) {
    const link = mod.exports["$rt.link"] as (() => number) | undefined;
    if (typeof link !== "function") continue;
    const bad = link();
    if (bad) throw new Error(`shared runtime: module "${ns}" expects atom ${bad - 1} to be its own, but the shared atom table already holds another name there: link every module before any module runs, and rebuild it against its owner's current link manifest`);
  }
  return { instance, modules, capabilities: { required, provided, fallbacks } };
}

const stringTrap = (message: string): never => { throw new (engine as unknown as { RuntimeError: new (m: string) => Error }).RuntimeError(message); };
const asString = (s: unknown): string => typeof s === "string" ? s : stringTrap("illegal cast");
/** `wasm:js-string` in plain JavaScript (the JS String Builtins proposal's semantics, traps included), for an engine
 * without the builtins: the functions the emitter imports, and the rest of the non-array set. */
export const jsStringPolyfill: Readonly<Record<string, (...args: never[]) => unknown>> = Object.freeze({
  cast: (s: unknown) => asString(s),
  test: (s: unknown) => (typeof s === "string" ? 1 : 0),
  length: (s: unknown) => asString(s).length,
  charCodeAt: (s: unknown, i: number) => { const t = asString(s); return i >>> 0 >= t.length ? stringTrap("string offset out of bounds") : t.charCodeAt(i); },
  codePointAt: (s: unknown, i: number) => { const t = asString(s); return i >>> 0 >= t.length ? stringTrap("string offset out of bounds") : t.codePointAt(i)!; },
  concat: (a: unknown, b: unknown) => asString(a) + asString(b),
  substring: (s: unknown, start: number, end: number) => {
    const t = asString(s); start >>>= 0; end >>>= 0;
    return start > t.length || start > end ? "" : t.substring(start, Math.min(end, t.length));
  },
  equals: (a: unknown, b: unknown) => {
    if (a !== null && typeof a !== "string") stringTrap("illegal cast");
    if (b !== null && typeof b !== "string") stringTrap("illegal cast");
    return a === b ? 1 : 0;
  },
  compare: (a: unknown, b: unknown) => { const x = asString(a), y = asString(b); return x < y ? -1 : x > y ? 1 : 0; },
  fromCharCode: (c: number) => String.fromCharCode(c & 0xffff),
  fromCodePoint: (c: number) => (c >>> 0 > 0x10ffff ? stringTrap("invalid code point") : String.fromCodePoint(c >>> 0)),
});

/** The capabilities a module records (its scriptc.capabilities section): from a compiled module or raw bytes; null
 * for a module built before capabilities were recorded. */
export function requiredCapabilities(module: object | Uint8Array): ResolvedCapabilities | null {
  if (module instanceof Uint8Array) return decodeCapabilitySection(readCustomSections(module, CAPABILITY_SECTION)[0] ?? new Uint8Array());
  const section = engine.Module.customSections?.(module, CAPABILITY_SECTION)?.[0];
  return section ? decodeCapabilitySection(section) : null;
}
export { detectCapabilities } from "./capabilities.js";
export { createTaskRing, runTaskConsumer, taskRingBytes, STATUS_CANCELLED, STATUS_STALE, STATUS_FAILED, RING_FULL, RING_STOPPED, RING_BAD_PUBLISH } from "./task-ring.js";
export type { TaskRing, TaskRingOptions, TaskRingLayout, TaskRunner } from "./task-ring.js";

/** The first variant of a set this engine runs (every hard requirement met), or a refusal naming each variant's gap. */
export function chooseVariant(set: VariantSet, caps: EngineCapabilities = detectCapabilities()): VariantSet["variants"][number] {
  const gaps: string[] = [];
  for (const v of set.variants) {
    const missing = missingRequirements(v.requires, caps);
    if (!missing.length) return v;
    gaps.push(`${v.file} requires ${refusalText(missing)}`);
  }
  throw new Error(`no variant of this module runs on this engine: ${gaps.join("; ")}`);
}

export interface LoadWasmGcOptions extends WasmGcHostOptions {
  /** Reads a URL's bytes (default: fetch). A loader under Node supplies one for file: URLs. */
  read?: (url: URL) => Promise<Uint8Array | ArrayBuffer>;
}

/** Loads a module by URL: `<module>.wasm.variants.json` (a variant set: the first variant this engine runs, chosen by
 * probe, is the only one downloaded), or a `.wasm` (its variant set beside it when there is one). The instance also
 * reports the file it loaded. */
export async function loadWasmGc(source: string | URL, opts: LoadWasmGcOptions = {}): Promise<WasmGcInstance & { variant: string }> {
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  const url = typeof source === "string" ? new URL(source, base) : source;
  const read = opts.read ?? (async (u: URL) => {
    const f = (globalThis as unknown as { fetch: (u: URL) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }> }).fetch;
    const r = await f(u);
    if (!r.ok) throw new Error(`${u.href}: HTTP ${r.status}`);
    return r.arrayBuffer();
  });
  const bytesOf = async (u: URL) => { const b = await read(u); return b instanceof Uint8Array ? b : new Uint8Array(b); };
  let set: VariantSet | null = null, setUrl = url;
  if (url.pathname.endsWith(".variants.json")) set = JSON.parse(new TextDecoder().decode(await bytesOf(url))) as VariantSet;
  else {
    setUrl = new URL(`${url.href}.variants.json`);
    try { set = JSON.parse(new TextDecoder().decode(await bytesOf(setUrl))) as VariantSet; } catch { set = null; }
  }
  if (set !== null && set.schema !== VARIANTS_SCHEMA) throw new Error(`${setUrl.href}: not a variant set (${VARIANTS_SCHEMA})`);
  const chosen = set ? new URL(chooseVariant(set).file, setUrl) : url;
  const instance = await instantiateWasmGc(await bytesOf(chosen), opts);
  return { ...instance, variant: chosen.pathname.split("/").pop()! };
}

/** Checked JS ingress for the first experimental closed-module ABI. Direct
 * Wasm callers already supply physical scalar values; this binding prevents
 * JS coercion from silently accepting objects or missing arguments. The
 * admission report is trusted compiler metadata, not a security authority. */
export function bindClosedExports(exports: Record<string, unknown>, profile: {
  schema: string; profile: string; admitted: boolean;
  entries: { name: string; params: string[]; result: string }[];
}): Record<string, (...args: unknown[]) => unknown> {
  if (profile.schema !== "scriptc-closed-profile/1" || profile.profile !== "owned-scalar-records/1" || !profile.admitted || !Array.isArray(profile.entries))
    throw new Error("a successfully admitted closed scalar-record profile is required");
  const bound: Record<string, (...args: unknown[]) => unknown> = Object.create(null);
  for (const entry of profile.entries) {
    const fn = exports[entry.name];
    if (typeof fn !== "function" || entry.params.some(t => t !== "f64" && t !== "bool") || !["f64", "bool", "void"].includes(entry.result))
      throw new Error(`invalid closed entry ${entry.name}`);
    bound[entry.name] = (...args: unknown[]) => {
      if (args.length !== entry.params.length) throw new TypeError(`${entry.name}: expected ${entry.params.length} arguments`);
      for (let i = 0; i < args.length; i++) {
        const expected = entry.params[i] === "f64" ? "number" : "boolean";
        if (typeof args[i] !== expected) throw new TypeError(`${entry.name} argument ${i}: expected ${expected}`);
      }
      const result = fn(...args);
      return entry.result === "bool" ? result !== 0 : result;
    };
  }
  return bound;
}
