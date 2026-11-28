/* Capability modes for WasmGC output (docs/capabilities.md §4).
 *
 * A module is built under one resolved mode: the exception-handling encoding, how byte views over module memory
 * survive growth, whether relaxed SIMD lowerings are allowed, and the threads mode. The mode's canonical key names
 * the build (cache keys, variant files); the module records the mode and the engine capabilities it requires in the
 * `scriptc.capabilities` custom section, which the host reads before instantiation.
 *
 * This file has no Node imports: the host (host.ts) and page loaders use it too. */

export const CAPABILITY_SECTION = "scriptc.capabilities";
export const CAPABILITY_SCHEMA = "wgc-cap/1";
export const VARIANTS_SCHEMA = "wgc-variants/1";

/** Byte views: `resizable` (views follow memory.grow through toResizableBuffer) or a fixed memory of N MiB that
 * never grows, so views never detach. */
export type ViewsMode = "resizable" | `fixed:${number}`;
export type ThreadsMode = "off" | "shared" | "auto";

export type MathMode = "fast" | "strict";

export interface CapabilityMode {
  eh: "exnref" | "legacy";
  views: ViewsMode;
  relaxedSimd: boolean;
  threads: ThreadsMode;
  /** strict (docs/intrinsics.md): deterministic floating point. No relaxed SIMD (its results vary in the low bits by
   * engine and CPU), and a program importing the strict-math library records it. Optional: absent reads as fast. */
  math?: MathMode;
}

/** Engine capabilities a module can require. `js-string-builtins` and `imported-string-constants` are soft: the host
 * supplies plain-JS replacements when the engine lacks them. */
export type Requirement =
  | "wasm-gc" | "exnref" | "legacy-eh" | "simd" | "relaxed-simd"
  | "js-string-builtins" | "imported-string-constants"
  | "resizable-memory-buffer" | "jspi" | "shared-memory" | "cross-origin-isolation";

export const SOFT_REQUIREMENTS: ReadonlySet<Requirement> = new Set(["js-string-builtins", "imported-string-constants"]);

/** What a module, as emitted, uses (the emitter reports it). */
export interface CapabilityUses {
  /** Typed arrays handed to JavaScript as views over module memory (host import bytes.toJs). */
  byteViews: boolean;
  /** A linear memory at all (typed arrays). */
  memory: boolean;
  /** Suspending imports (module "jspi"). */
  jspi: boolean;
  /** Relaxed SIMD lowerings emitted. */
  relaxedSimd: boolean;
  /** SIMD instructions possible (typed-array helpers or the SIMD library). */
  simd: boolean;
  /** An imported shared memory (wasm link). */
  sharedMemory: boolean;
  /** The intrinsic libraries the module imports (int, math, layout, f16, atomics, simd), sorted. */
  intrinsics?: string[];
}

/** The record the `<out>.capabilities.json` sidecar carries. The `scriptc.capabilities` section carries the same
 * without `mode` (the key spells it; modeOfKey reads it back). */
export interface ResolvedCapabilities {
  schema: typeof CAPABILITY_SCHEMA;
  key: string;
  mode: CapabilityMode;
  /** "preferred", or "compat" for the second variant of a set. */
  variant: "preferred" | "compat";
  requires: Requirement[];
  /** The intrinsic libraries the module imports, when it imports any. */
  intrinsics?: string[];
}

export const BASELINE_MODE: CapabilityMode = Object.freeze({ eh: "exnref", views: "resizable", relaxedSimd: false, threads: "off" });
/** The fixed memory a compat variant gets when the request names no size. */
export const DEFAULT_FIXED_MIB = 256;
/** 4 GiB: the module memory's declared maximum. */
const MAX_FIXED_MIB = 4096;

/** The canonical key of a mode: the only form that may enter a cache key or name a variant. */
export function capabilityKey(mode: CapabilityMode): string {
  // math=strict joins the key only when set, so every key built before the mode existed is unchanged.
  return `${CAPABILITY_SCHEMA};eh=${mode.eh};views=${mode.views};relaxed=${mode.relaxedSimd ? 1 : 0};threads=${mode.threads}${mode.math === "strict" ? ";math=strict" : ""}`;
}

/** MiB of a fixed view mode, or null for resizable. */
export function fixedMiB(views: ViewsMode): number | null {
  return views === "resizable" ? null : Number(views.slice("fixed:".length));
}

/** The engine capabilities a module built under `mode` with `uses` requires. */
export function requirementsOf(mode: CapabilityMode, uses: CapabilityUses): Requirement[] {
  const out: Requirement[] = ["wasm-gc", mode.eh === "exnref" ? "exnref" : "legacy-eh", "js-string-builtins", "imported-string-constants"];
  if (uses.simd) out.push("simd");
  if (uses.relaxedSimd) out.push("relaxed-simd");
  if (uses.byteViews && !uses.sharedMemory && mode.views === "resizable") out.push("resizable-memory-buffer");
  if (uses.jspi) out.push("jspi");
  if (uses.sharedMemory || mode.threads === "shared") out.push("shared-memory", "cross-origin-isolation");
  return out;
}

/* ── targets ───────────────────────────────────────────────────────────── */

export type Engine = "chrome" | "firefox" | "safari" | "node";
export interface Target { engine: Engine; version: number[] }

/** The default targets when none are declared: the baseline's floor (docs/capabilities.md §2). */
export const DEFAULT_TARGETS = "chrome>=137,firefox>=134,safari>=26.2,node>=24.15";

/** First stable release shipping each requirement unflagged, per engine; null: no stable release has it. Sources and
 * unresolved cells: docs/capabilities.md §2. The soft string requirements are absent: the host supplies them. */
export const SUPPORT: Readonly<Partial<Record<Requirement, Readonly<Record<Engine, string | null>>>>> = {
  "wasm-gc": { chrome: "119", firefox: "120", safari: "18.2", node: "22" },
  "exnref": { chrome: "137", firefox: "131", safari: "18.4", node: "24.15" },
  "legacy-eh": { chrome: "95", firefox: "100", safari: "15.2", node: "17" },
  "simd": { chrome: "91", firefox: "89", safari: "16.4", node: "16.4" },
  "relaxed-simd": { chrome: "114", firefox: "145", safari: null, node: "21" },
  "resizable-memory-buffer": { chrome: "144", firefox: "145", safari: "26.2", node: "26" },
  "jspi": { chrome: "137", firefox: "153", safari: "27", node: "25" },
  "shared-memory": { chrome: "74", firefox: "79", safari: "15.2", node: "16.4" },
};

const ENGINES: readonly Engine[] = ["chrome", "firefox", "safari", "node"];
const parseVersion = (v: string): number[] => v.split(".").map(Number);
const cmp = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; }
  return 0;
};

/** `chrome>=137,safari>=26.2,node>=24` (also `chrome137`, `node 24`): each engine's oldest version to support. */
export function parseTargets(spec: string | readonly string[]): { targets: Target[]; errors: string[] } {
  const items = (typeof spec === "string" ? spec.split(",") : spec).map(s => s.trim()).filter(Boolean);
  const targets: Target[] = [], errors: string[] = [];
  for (const item of items) {
    const m = /^([a-z]+)\s*(?:>=)?\s*(\d+(?:\.\d+){0,2})$/.exec(item.toLowerCase());
    if (!m || !ENGINES.includes(m[1] as Engine)) { errors.push(`target "${item}": expected <engine>>=<version>, engine one of ${ENGINES.join(", ")}`); continue; }
    targets.push({ engine: m[1] as Engine, version: parseVersion(m[2]!) });
  }
  return { targets, errors };
}
export const formatTarget = (t: Target): string => `${t.engine}>=${t.version.join(".")}`;

/** The targets among `targets` that lack `req` (a soft requirement is never lacking). */
export function targetsLacking(req: Requirement, targets: readonly Target[]): Target[] {
  const row = SUPPORT[req];
  if (!row) return [];
  return targets.filter(t => { const first = row[t.engine]; return first === null || cmp(t.version, parseVersion(first)) < 0; });
}

/** "Chrome 144, Firefox 145, Safari 26.2, Node 26": the first releases with `req`, for refusal messages. */
export function supportText(req: Requirement): string {
  const row = SUPPORT[req];
  if (!row) return "";
  const name: Record<Engine, string> = { chrome: "Chrome", firefox: "Firefox", safari: "Safari", node: "Node" };
  return ENGINES.map(e => row[e] === null ? `not in ${name[e]}` : `${name[e]} ${row[e]}`).join(", ");
}

/* ── requests ──────────────────────────────────────────────────────────── */

/** What a build asks for: a preset, or a list (`eh=legacy,views=fixed:128,relaxed-simd,threads=auto,-jspi`). */
export interface CapabilityRequest {
  /** auto (the default): the baseline, plus one compat variant when a target needs one and the program uses the
   * feature. baseline: the baseline only. compat: the compat mode only. */
  preset: "auto" | "baseline" | "compat";
  eh?: CapabilityMode["eh"];
  views?: ViewsMode;
  relaxedSimd?: boolean;
  threads?: ThreadsMode;
  /** false (`-jspi`): refuse a program that suspends on host promises. */
  jspi?: boolean;
  math?: MathMode;
}

export function parseCapabilities(spec: string | undefined): { request: CapabilityRequest; errors: string[] } {
  const request: CapabilityRequest = { preset: "auto" }, errors: string[] = [];
  for (const raw of (spec ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
    if (raw === "auto" || raw === "baseline" || raw === "compat") { request.preset = raw; continue; }
    const [k, v] = raw.split("=") as [string, string | undefined];
    if (k === "eh" && (v === "exnref" || v === "legacy")) request.eh = v;
    else if (k === "views" && v === "resizable") request.views = "resizable";
    else if (k === "views" && v !== undefined && /^fixed(:\d+)?$/.test(v)) {
      const mib = v === "fixed" ? DEFAULT_FIXED_MIB : Number(v.slice(6));
      if (mib < 1 || mib > MAX_FIXED_MIB) errors.push(`views=fixed takes 1 to ${MAX_FIXED_MIB} MiB, not ${mib}`);
      else request.views = `fixed:${mib}`;
    } else if ((k === "relaxed-simd" || k === "+relaxed-simd") && v === undefined) request.relaxedSimd = true;
    else if (k === "-relaxed-simd" && v === undefined) request.relaxedSimd = false;
    else if (k === "threads" && (v === "off" || v === "shared" || v === "auto")) request.threads = v;
    else if ((k === "jspi" || k === "+jspi") && v === undefined) request.jspi = true;
    else if (k === "math" && (v === "fast" || v === "strict")) request.math = v;
    else if (k === "-jspi" && v === undefined) request.jspi = false;
    else errors.push(`capability "${raw}": expected auto, baseline, compat, eh=exnref|legacy, views=resizable|fixed[:<MiB>], [-]relaxed-simd, threads=off|shared|auto, [-]jspi or math=fast|strict`);
  }
  return { request, errors };
}

/** The mode a build's first (preferred) artifact uses. */
export function preferredMode(request: CapabilityRequest): CapabilityMode {
  const base: CapabilityMode = request.preset === "compat" ? compatOf(BASELINE_MODE, request) : { ...BASELINE_MODE };
  return {
    eh: request.eh ?? base.eh,
    views: request.views ?? base.views,
    relaxedSimd: request.relaxedSimd ?? base.relaxedSimd,
    threads: request.threads ?? base.threads,
    ...((request.math ?? base.math) === "strict" ? { math: "strict" as const } : {}),
  };
}

function compatOf(mode: CapabilityMode, request: CapabilityRequest): CapabilityMode {
  return { eh: "legacy", views: request.views !== undefined && request.views !== "resizable" ? request.views : `fixed:${DEFAULT_FIXED_MIB}`, relaxedSimd: false, threads: mode.threads, ...(mode.math === "strict" ? { math: "strict" as const } : {}) };
}

export interface VariantPlan {
  /** A second, compat mode to build, or null. */
  compat: CapabilityMode | null;
  /** Build errors: a requirement no variant can meet for a declared target. */
  errors: string[];
  /** Why each value was chosen (--explain-capabilities). */
  explain: string[];
}

/** After the preferred build: whether a compat variant is needed for `targets`, given what the program uses. At most
 * one compat variant; only when a target lacks a requirement the preferred artifact has and the compat mode lifts. */
export function planVariants(request: CapabilityRequest, preferred: CapabilityMode, uses: CapabilityUses, targets: readonly Target[]): VariantPlan {
  const explain: string[] = [], errors: string[] = [];
  const list = (ts: readonly Target[]) => ts.map(formatTarget).join(", ");
  explain.push(`targets: ${list(targets)}`);
  explain.push(`preferred: ${capabilityKey(effectiveMode(preferred, uses))}`);
  const needs = requirementsOf(preferred, uses).filter(r => !SOFT_REQUIREMENTS.has(r));
  explain.push(`preferred requires: ${needs.join(", ")} (strings: the host falls back to plain JavaScript when the engine lacks them)`);
  if (preferred.math === "strict" && preferred.relaxedSimd) errors.push("math=strict refuses relaxed SIMD: its results differ in the low bits by engine and CPU (drop relaxed-simd, or use math=fast)");
  explain.push(...intrinsicsExplain(preferred, uses));
  if (uses.jspi && request.jspi === false) errors.push("the program suspends on host promises (a suspending FFI import), and the capabilities refuse JSPI (-jspi)");
  if (uses.jspi) {
    const lacking = targetsLacking("jspi", targets);
    if (lacking.length) errors.push(`the program suspends on host promises (a suspending FFI import), which needs JSPI (${supportText("jspi")}); targets ${list(lacking)} lack it, and no variant can provide it`);
  }
  if (uses.sharedMemory || preferred.threads === "shared") {
    const lacking = targetsLacking("shared-memory", targets);
    if (lacking.length) errors.push(`threads=shared needs a shared WebAssembly.Memory (${supportText("shared-memory")}); targets ${list(lacking)} lack it`);
    explain.push("threads: shared memory; a browser page must be cross-origin isolated (COOP and COEP)");
  }
  let compat: CapabilityMode | null = null;
  const lift: string[] = [];
  if (request.preset === "auto") {
    const ehLacking = preferred.eh === "exnref" ? targetsLacking("exnref", targets) : [];
    const viewsLacking = uses.byteViews && !uses.sharedMemory && preferred.views === "resizable" ? targetsLacking("resizable-memory-buffer", targets) : [];
    const relaxedLacking = uses.relaxedSimd ? targetsLacking("relaxed-simd", targets) : [];
    if (ehLacking.length || viewsLacking.length || relaxedLacking.length) {
      compat = {
        eh: ehLacking.length ? "legacy" : preferred.eh,
        views: viewsLacking.length ? (request.views && request.views !== "resizable" ? request.views : `fixed:${DEFAULT_FIXED_MIB}`) : preferred.views,
        relaxedSimd: relaxedLacking.length ? false : preferred.relaxedSimd,
        threads: preferred.threads,
        ...(preferred.math === "strict" ? { math: "strict" as const } : {}),
      };
      if (ehLacking.length) lift.push(`eh=legacy for ${list(ehLacking)} (no exnref)`);
      if (viewsLacking.length) lift.push(`views=${compat.views} for ${list(viewsLacking)} (no WebAssembly.Memory.prototype.toResizableBuffer; the program hands typed arrays to JavaScript)`);
      if (relaxedLacking.length) lift.push(`relaxed SIMD off for ${list(relaxedLacking)}`);
      explain.push(`compat variant: ${capabilityKey(compat)}: ${lift.join("; ")}`);
    } else explain.push("compat variant: none (every target meets the preferred requirements, or the program does not use the features that differ)");
  } else explain.push(`compat variant: none (preset ${request.preset})`);
  return { compat, errors, explain };
}

export function resolvedRecord(mode: CapabilityMode, uses: CapabilityUses, variant: "preferred" | "compat"): ResolvedCapabilities {
  const resolved = effectiveMode(mode, uses);
  return { schema: CAPABILITY_SCHEMA, key: capabilityKey(resolved), mode: resolved, variant, requires: requirementsOf(resolved, uses),
    ...(uses.intrinsics?.length ? { intrinsics: [...uses.intrinsics] } : {}) };
}

/** The mode a module is built under: a program importing the strict-math library is math=strict whatever was asked,
 * and a module on a shared link memory (wasmLink.memory.shared) is threads=shared unless it asked for auto. */
export function effectiveMode(mode: CapabilityMode, uses: CapabilityUses): CapabilityMode {
  const out = uses.intrinsics?.includes("math") && mode.math !== "strict" ? { ...mode, math: "strict" as const } : { ...mode };
  if (uses.sharedMemory && out.threads === "off") out.threads = "shared";
  return out;
}

/** How each intrinsic library the program imports is provided (--explain-capabilities; docs/intrinsics.md). */
export const INTRINSIC_EXPLAIN: Readonly<Record<string, string>> = {
  int: "int: i32/i64 instructions (clz, ctz, popcnt, rotl, rotr, mul, wrap); saturating forms through i64; fallback: the module's exact JavaScript",
  math: "math: the in-module fdlibm routines, the same source the library's JavaScript was generated from; NaN results canonical; fallback: the generated JavaScript (bit-identical)",
  layout: "layout: fixed-offset little-endian loads and stores on module memory through DataView; fallback: the same DataView accessors in JavaScript",
  f16: "f16: binary16 storage converted to f64 at load and store in wasm (no f16 arithmetic); fallback: Float16Array/DataView.getFloat16 when the engine has them, else the module's software conversion",
  atomics: "atomics: wasm atomic instructions on module memory; wait/notify need threads=shared; fallback: the single-threaded task ring (threads=off), same results",
  simd: "simd: wasm SIMD128 instructions; fallback: the module's lane-exact scalar JavaScript",
};
export function intrinsicsExplain(mode: CapabilityMode, uses: CapabilityUses): string[] {
  const out: string[] = [];
  const math = effectiveMode(mode, uses).math ?? "fast";
  out.push(`math: ${math}${math === "strict" ? (uses.intrinsics?.includes("math") ? " (the program imports the strict-math library)" : " (requested)") + "; relaxed SIMD off; NaNs stored to memory canonical" : " (the default)"}`);
  for (const lib of uses.intrinsics ?? []) out.push(`intrinsics: ${INTRINSIC_EXPLAIN[lib] ?? `${lib}: compiled from the module's own bodies (this compiler has no lowering for it)`}`);
  return out;
}

/** A variant set (`<out>.variants.json`): artifacts in order of preference. */
export interface VariantSet {
  schema: typeof VARIANTS_SCHEMA;
  variants: { file: string; key: string; requires: Requirement[] }[];
}

/* ── the custom section ────────────────────────────────────────────────── */

export function encodeCapabilitySection(record: ResolvedCapabilities): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ key: record.key, variant: record.variant, requires: record.requires, ...(record.intrinsics ? { intrinsics: record.intrinsics } : {}) }));
}

/** The mode a canonical key spells, or null for a key of another schema. */
export function modeOfKey(key: string): CapabilityMode | null {
  const parts = key.split(";");
  if (parts[0] !== CAPABILITY_SCHEMA) return null;
  const kv = Object.fromEntries(parts.slice(1).map(p => p.split("=") as [string, string]));
  const views = kv["views"] === "resizable" || /^fixed:\d+$/.test(kv["views"] ?? "") ? kv["views"] as ViewsMode : null;
  if ((kv["eh"] !== "exnref" && kv["eh"] !== "legacy") || !views || !["off", "shared", "auto"].includes(kv["threads"] ?? "")) return null;
  if (kv["math"] !== undefined && kv["math"] !== "strict") return null;
  return { eh: kv["eh"], views, relaxedSimd: kv["relaxed"] === "1", threads: kv["threads"] as ThreadsMode, ...(kv["math"] === "strict" ? { math: "strict" as const } : {}) };
}

export function decodeCapabilitySection(payload: ArrayBuffer | Uint8Array): ResolvedCapabilities | null {
  try {
    const r = JSON.parse(new TextDecoder().decode(payload)) as { key: string; variant?: "preferred" | "compat"; requires: Requirement[]; intrinsics?: string[] };
    const mode = r && typeof r.key === "string" ? modeOfKey(r.key) : null;
    return mode && Array.isArray(r.requires) ? { schema: CAPABILITY_SCHEMA, key: r.key, mode, variant: r.variant ?? "preferred", requires: r.requires,
      ...(Array.isArray(r.intrinsics) ? { intrinsics: r.intrinsics } : {}) } : null;
  } catch { return null; }
}

const leb = (n: number): number[] => { const out: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };

/** Appends a custom section to a wasm binary (custom sections may appear anywhere; wasm-merge drops them, so a merge
 * step re-appends the ones the host reads). */
export function appendCustomSection(binary: Uint8Array, name: string, payload: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const body = [...leb(nameBytes.length), ...nameBytes];
  const size = leb(body.length + payload.length);
  const out = new Uint8Array(binary.length + 1 + size.length + body.length + payload.length);
  out.set(binary, 0);
  let at = binary.length;
  out[at++] = 0;
  out.set(size, at); at += size.length;
  out.set(body, at); at += body.length;
  out.set(payload, at);
  return out;
}

/** The payloads of the custom sections named `name`, read from raw bytes (no compilation: works on a module this
 * engine cannot compile, which is when a refusal needs it). */
export function readCustomSections(binary: Uint8Array, name: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  if (binary.length < 8) return out;
  let at = 8;
  const u32 = (): number => { let r = 0, s = 0, b: number; do { b = binary[at++]!; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80 && at < binary.length); return r >>> 0; };
  const want = new TextEncoder().encode(name);
  while (at < binary.length) {
    const id = binary[at++]!;
    const size = u32();
    const end = at + size;
    if (end > binary.length) break;
    if (id === 0) {
      const n = u32();
      if (n === want.length && want.every((c, i) => binary[at + i] === c)) out.push(binary.subarray(at + n, end));
    }
    at = end;
  }
  return out;
}

/** A module's recorded capabilities: from a compiled module (WebAssembly.Module.customSections) or raw bytes. */
export function capabilitiesOfBytes(binary: Uint8Array): ResolvedCapabilities | null {
  const s = readCustomSections(binary, CAPABILITY_SECTION)[0];
  return s ? decodeCapabilitySection(s) : null;
}

/* ── engine detection ──────────────────────────────────────────────────── */

/** What this engine and page offer, by probe: tiny modules validated (never the artifact), JS-API presence, and the
 * deployment checks. */
export interface EngineCapabilities {
  "wasm-gc": boolean;
  "exnref": boolean;
  "legacy-eh": boolean;
  "simd": boolean;
  "relaxed-simd": boolean;
  "js-string-builtins": boolean;
  "imported-string-constants": boolean;
  "resizable-memory-buffer": boolean;
  "jspi": boolean;
  "shared-memory": boolean;
  "cross-origin-isolation": boolean;
  /** Not requirements, reported for the threads mode. */
  sharedArrayBuffer: boolean;
  atomicsWaitAsync: boolean;
}

const HDR = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
const B = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat());
const VOID_FN = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03, 0x02, 0x01, 0x00];
const code = (body: number[]): number[] => [0x0a, ...leb(body.length + 2), 0x01, ...leb(body.length), ...body];
const V128_ZERO = [0xfd, 0x0c, ...new Array(16).fill(0)];
/** Probe modules: each validates exactly when the engine has the feature. */
export const PROBES = {
  "wasm-gc": B(HDR, [0x01, 0x05, 0x01, 0x5f, 0x01, 0x7f, 0x01]),
  // block (result exnref) try_table (catch_all_ref 0) end unreachable end throw_ref
  "exnref": B(HDR, VOID_FN, [0x0d, 0x03, 0x01, 0x00, 0x00], code([0x00, 0x02, 0x69, 0x1f, 0x40, 0x01, 0x03, 0x00, 0x0b, 0x00, 0x0b, 0x0a, 0x0b])),
  // try catch_all end
  "legacy-eh": B(HDR, VOID_FN, [0x0d, 0x03, 0x01, 0x00, 0x00], code([0x00, 0x06, 0x40, 0x19, 0x0b, 0x0b])),
  "simd": B(HDR, VOID_FN, code([0x00, ...V128_ZERO, 0x1a, 0x0b])),
  // f32x4.relaxed_madd (0xfd 0x105) over three zero vectors
  "relaxed-simd": B(HDR, VOID_FN, code([0x00, ...V128_ZERO, ...V128_ZERO, ...V128_ZERO, 0xfd, 0x85, 0x02, 0x1a, 0x0b])),
} as const;

/** A module importing `wasm:js-string` `length` and one string constant from "'": which of the two the engine
 * supplies itself (an import it supplies is no longer listed). */
const STRINGS_PROBE = (() => {
  const enc = (s: string) => [...leb(s.length), ...new TextEncoder().encode(s)];
  const imports = [0x02, ...((b: number[]) => [...leb(b.length), ...b])([0x02, ...enc("wasm:js-string"), ...enc("length"), 0x00, 0x01, ...enc("'"), ...enc("hi"), 0x03, 0x6f, 0x00])];
  return B(HDR, [0x01, 0x0a, 0x02, 0x5f, 0x01, 0x7f, 0x01, 0x60, 0x01, 0x6f, 0x01, 0x7f], imports);
})();

interface WasmApi {
  validate(bytes: Uint8Array, options?: unknown): boolean;
  Module: { new (bytes: Uint8Array, options?: unknown): object; imports(m: object): { module: string; name: string }[] };
  Memory: { new (d: { initial: number; maximum?: number; shared?: boolean }): { buffer: unknown }; prototype: object };
  Suspending?: unknown; promising?: unknown;
}

let detected: EngineCapabilities | undefined;
/** Probes once per realm; `fresh` probes again (a test that deleted an entry point). */
export function detectCapabilities(fresh = false): EngineCapabilities {
  if (detected && !fresh) return detected;
  const g = globalThis as unknown as { WebAssembly?: WasmApi; crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown; Atomics?: { waitAsync?: unknown } };
  const W = g.WebAssembly;
  const valid = (bytes: Uint8Array) => { try { return W!.validate(bytes); } catch { return false; } };
  let builtins = false, constants = false;
  if (W) {
    try {
      const listed = new Set(W.Module.imports(new W.Module(STRINGS_PROBE, { builtins: ["js-string"], importedStringConstants: "'" })).map(i => i.module));
      builtins = !listed.has("wasm:js-string");
      constants = !listed.has("'");
    } catch { /* no GC: both stay false */ }
  }
  let sharedMemory = false;
  try { sharedMemory = W !== undefined && typeof SharedArrayBuffer !== "undefined" && new W.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof SharedArrayBuffer; } catch { /* absent */ }
  const isNode = typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === "string";
  detected = {
    "wasm-gc": W !== undefined && valid(PROBES["wasm-gc"]),
    "exnref": W !== undefined && valid(PROBES["exnref"]),
    "legacy-eh": W !== undefined && valid(PROBES["legacy-eh"]),
    "simd": W !== undefined && valid(PROBES["simd"]),
    "relaxed-simd": W !== undefined && valid(PROBES["relaxed-simd"]),
    "js-string-builtins": builtins,
    "imported-string-constants": constants,
    "resizable-memory-buffer": W !== undefined && typeof (W.Memory.prototype as { toResizableBuffer?: unknown }).toResizableBuffer === "function",
    "jspi": W !== undefined && typeof W.Suspending === "function" && typeof W.promising === "function",
    "shared-memory": sharedMemory,
    // Node agents share memory without COOP/COEP; a page must be isolated.
    "cross-origin-isolation": isNode || g.crossOriginIsolated === true,
    sharedArrayBuffer: typeof g.SharedArrayBuffer === "function",
    atomicsWaitAsync: typeof g.Atomics?.waitAsync === "function",
  };
  return detected;
}

/** The hard requirements of `record` this engine lacks (soft ones are the host's to supply). */
export function missingRequirements(requires: readonly Requirement[], caps: EngineCapabilities = detectCapabilities()): Requirement[] {
  return requires.filter(r => !SOFT_REQUIREMENTS.has(r) && !caps[r]);
}

/** A refusal naming what is missing and where to get it. */
export function refusalText(missing: readonly Requirement[]): string {
  const what: Record<Requirement, string> = {
    "wasm-gc": "WasmGC", "exnref": "WebAssembly exception handling with exnref", "legacy-eh": "WebAssembly exception handling",
    "simd": "WebAssembly SIMD", "relaxed-simd": "relaxed SIMD", "js-string-builtins": "JS String Builtins",
    "imported-string-constants": "imported string constants", "resizable-memory-buffer": "WebAssembly.Memory.prototype.toResizableBuffer",
    "jspi": "JSPI (WebAssembly.Suspending / WebAssembly.promising)", "shared-memory": "a shared WebAssembly.Memory",
    "cross-origin-isolation": "cross-origin isolation",
  };
  return missing.map(r => {
    if (r === "cross-origin-isolation") return `${what[r]} (serve the page with "Cross-Origin-Opener-Policy: same-origin" and "Cross-Origin-Embedder-Policy: require-corp")`;
    const where = supportText(r);
    const hint = r === "resizable-memory-buffer" ? "; under Node 24 or 25 run with --experimental-wasm-rab-integration, or build with --capabilities views=fixed:<MiB>"
      : r === "exnref" ? "; or build with --capabilities eh=legacy" : r === "relaxed-simd" ? "; or build without relaxed SIMD" : "";
    return where ? `${what[r]} (${where}${hint})` : what[r];
  }).join("; ");
}

/** The record of a merged binary: every input's requirements; the inputs must agree on the mode (one key). */
export function mergeCapabilityRecords(records: readonly ResolvedCapabilities[]): ResolvedCapabilities {
  if (!records.length) throw new Error("merging capabilities: no records");
  const keys = new Set(records.map(r => r.key));
  if (keys.size !== 1) throw new Error(`merged modules disagree on their capability mode: ${[...keys].join(" / ")}; build every module with the same capabilities`);
  const requires = [...new Set(records.flatMap(r => r.requires))];
  return { ...records[0]!, requires };
}

/** After a merge (wasm-merge drops custom sections): `merged` with the inputs' scriptc.capabilities record appended
 * again, merged across inputs. Inputs without a record (built before capabilities were recorded) are skipped. */
export function withMergedCapabilities(merged: Uint8Array, inputs: readonly Uint8Array[]): Uint8Array {
  const records = inputs.map(capabilitiesOfBytes).filter((r): r is ResolvedCapabilities => r !== null);
  if (!records.length) return merged;
  return appendCustomSection(merged, CAPABILITY_SECTION, encodeCapabilitySection(mergeCapabilityRecords(records)));
}
