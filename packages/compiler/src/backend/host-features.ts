/** The host's services a host-island program reaches, and the host pack set that answers them (host-island.ts).
 *
 * The generic host builds as sets of services (native/host: scriptc-host's cargo features; a host pack ships several
 * archives, each naming its services). The host ABI is name-based (`global_get`, `call_method`, `module_call`), so
 * the services a program needs follow from the names its IR reaches:
 *
 * - `window`: what renders: canvases and `getContext`, `screen`, `matchMedia`, `devicePixelRatio`, fullscreen,
 *   pointer lock, the clipboard, `alert` / `confirm` / `prompt`. The document, its timers, frames and storage are
 *   the core's, in every set. `window` brings `gpu`.
 * - `gpu`: `navigator.gpu` (and `getContext`, through `window`).
 * - `audio`: `AudioContext`, `webkitAudioContext`, `OfflineAudioContext`, `Audio`.
 * - `rtc`: `RTCPeerConnection` and its kin. `rtc` brings `net`.
 * - `net`: `fetch` (the page's, and a static fetch), `XMLHttpRequest`, `WebSocket`, `EventSource`,
 *   `navigator.sendBeacon`.
 * - a typed `host:` module: the services the pack lists for it, else every service.
 *
 * A read the pass cannot name (a computed global read, the global object itself used as a value, the native dyn
 * model's opaque global reads) needs every service: the selection is then the pack's full set. */
import type { IrExpr, IrModule, SrcLoc } from "../ir/ir.js";
import { everyStmtList } from "../ir/traverse.js";

export const HOST_SERVICES = ["window", "gpu", "audio", "net", "rtc"] as const;
export type HostService = (typeof HOST_SERVICES)[number];

/** A service and the services it brings with it. */
export const HOST_SERVICE_IMPLIES: Readonly<Record<HostService, readonly HostService[]>> = {
  window: ["gpu"],
  gpu: [],
  audio: [],
  net: [],
  rtc: ["net"],
};

export function isHostService(name: string): name is HostService {
  return (HOST_SERVICES as readonly string[]).includes(name);
}

/** The services and everything they bring, in HOST_SERVICES order. */
export function closeHostServices(services: Iterable<HostService>): HostService[] {
  const out = new Set<HostService>();
  const add = (s: HostService): void => {
    if (out.has(s)) return;
    out.add(s);
    for (const t of HOST_SERVICE_IMPLIES[s]) add(t);
  };
  for (const s of services) add(s);
  return HOST_SERVICES.filter((s) => out.has(s));
}

/** Global names and the service each needs. Every other global is the core's. */
export const HOST_GLOBAL_SERVICES: Readonly<Record<string, HostService>> = {
  HTMLCanvasElement: "window",
  OffscreenCanvas: "window",
  CanvasRenderingContext2D: "window",
  screen: "window",
  matchMedia: "window",
  devicePixelRatio: "window",
  alert: "window",
  confirm: "window",
  prompt: "window",
  AudioContext: "audio",
  webkitAudioContext: "audio",
  OfflineAudioContext: "audio",
  Audio: "audio",
  RTCPeerConnection: "rtc",
  RTCDataChannel: "rtc",
  RTCSessionDescription: "rtc",
  RTCIceCandidate: "rtc",
  fetch: "net",
  XMLHttpRequest: "net",
  WebSocket: "net",
  EventSource: "net",
};

/** Member names (on any page value) and the service each needs. */
export const HOST_MEMBER_SERVICES: Readonly<Record<string, HostService>> = {
  getContext: "window",
  requestFullscreen: "window",
  exitFullscreen: "window",
  fullscreenElement: "window",
  requestPointerLock: "window",
  exitPointerLock: "window",
  pointerLockElement: "window",
  clipboard: "window",
  gpu: "gpu",
  sendBeacon: "net",
};

/** The global object's names: a static member of one reads as that global. */
const GLOBAL_ALIASES = new Set(["window", "self", "globalThis", "frames", "top", "parent"]);

/** Library calls that read globals by a name the pass cannot see: every service. */
const OPAQUE_GLOBAL_FNS = new Set([
  "global.native",
  "global.hostAbsent",
  "global.forInObject",
  "dyn.globalHas",
  "dyn.globalSymbolGet",
  "dyn.globalSymbolSet",
  "dyn.globalSymbolHas",
  "dyn.globalSymbolDelete",
]);

/** Library calls that read one global by its name (their first argument). */
const NAMED_GLOBAL_FNS = new Set(["global.bindingRead", "global.bindingValue", "global.bindingHas", "dyn.globalConstructor"]);

/** What one program reaches. */
export interface HostReach {
  /** The services the program's names need, before implications. */
  services: HostService[];
  /** The typed `host:` modules it calls. */
  modules: string[];
  /** Why the program needs every service (the first such read), or null. */
  opaque: { what: string; loc: SrcLoc } | null;
  /** The first read that needs each service, for --explain-host. */
  first: Partial<Record<HostService, { name: string; loc: SrcLoc }>>;
  firstModule: Record<string, SrcLoc>;
}

/** The host services a module's IR reaches (the module the backend links). */
export function hostReach(mod: Pick<IrModule, "functions">): HostReach {
  const services = new Set<HostService>();
  const first: HostReach["first"] = {};
  const firstModule: Record<string, SrcLoc> = {};
  let opaque: HostReach["opaque"] = null;
  const need = (s: HostService | undefined, name: string, loc: SrcLoc): void => {
    if (s === undefined) return;
    services.add(s);
    first[s] ??= { name, loc };
  };
  const opaqueRead = (what: string, loc: SrcLoc): void => {
    opaque ??= { what, loc };
  };
  // The global-object reads used as the receiver of a member with a static name: those read as the member's global.
  const aliasReceivers = new Set<IrExpr>();
  const isAlias = (e: IrExpr | undefined): boolean =>
    e?.kind === "jsOp" && e.op === "globalGet" && e.name !== undefined && GLOBAL_ALIASES.has(e.name);
  for (const fn of mod.functions) {
    everyStmtList(fn.body, {
      expr: (node) => {
        if (node.kind === "jsOp") {
          const receiver = node.args[0];
          if ((node.op === "getProp" || node.op === "setProp" || node.op === "callMethod" || node.op === "optCallMethod") && node.name !== undefined) {
            need(HOST_MEMBER_SERVICES[node.name], node.name, node.loc);
            if (isAlias(receiver)) {
              aliasReceivers.add(receiver!);
              need(HOST_GLOBAL_SERVICES[node.name], node.name, node.loc);
            }
          }
          if (node.op === "callMethod" && node.name === "createElement") {
            const tag = node.args[1];
            if (tag?.kind === "strLit" && tag.value.toLowerCase() === "canvas") need("window", "createElement(\"canvas\")", node.loc);
          }
          if (node.op === "globalGet" && node.name !== undefined) need(HOST_GLOBAL_SERVICES[node.name], node.name, node.loc);
        } else if (node.kind === "libCall") {
          if (node.fn.startsWith("fetch.")) need("net", "fetch", node.loc);
          else if (node.fn === "host.call") {
            const m = node.args[0];
            if (m?.kind === "strLit") firstModule[m.value] ??= node.loc;
            else opaqueRead("a host module call without its module name", node.loc);
          } else if (OPAQUE_GLOBAL_FNS.has(node.fn)) opaqueRead(node.fn, node.loc);
          else if (NAMED_GLOBAL_FNS.has(node.fn)) {
            const n = node.args[0];
            if (n?.kind === "strLit") need(HOST_GLOBAL_SERVICES[n.value], n.value, node.loc);
            else opaqueRead(`${node.fn} of a computed name`, node.loc);
          }
        }
        return true;
      },
      stmt: () => true,
    });
    if (fn.name === "%builtin.Function.returnThis") opaqueRead('Function("return this")', fn.loc);
  }
  // Every other read of the global object (a computed member, the object passed or stored as a value, `in` tests).
  for (const fn of mod.functions) {
    everyStmtList(fn.body, {
      expr: (node) => {
        if (isAlias(node) && !aliasReceivers.has(node)) opaqueRead(`${(node as { name: string }).name} used as a value`, node.loc);
        return true;
      },
      stmt: () => true,
    });
  }
  return { services: HOST_SERVICES.filter((s) => services.has(s)), modules: Object.keys(firstModule).sort(), opaque, first, firstModule };
}

/** `--host-features`: `name` adds a service, `-name` removes one. */
export interface HostFeatureRequest {
  add: HostService[];
  remove: HostService[];
}

export function parseHostFeatures(list: readonly string[]): HostFeatureRequest {
  const add: HostService[] = [];
  const remove: HostService[] = [];
  for (const raw of list.flatMap((item) => item.split(","))) {
    const item = raw.trim();
    if (item === "") continue;
    const minus = item.startsWith("-");
    const name = minus ? item.slice(1) : item.startsWith("+") ? item.slice(1) : item;
    if (!isHostService(name)) {
      throw new Error(`unknown host service '${name}' (the services: ${HOST_SERVICES.join(", ")})`);
    }
    (minus ? remove : add).push(name);
  }
  return { add, remove };
}

/** A host pack's set, as the selection sees it. */
export interface HostSetChoice {
  name: string;
  services: readonly HostService[];
}

/** What the selection decided, and why (--explain-host). */
export interface HostSelection {
  set: string;
  required: HostService[];
  excluded: HostService[];
  reason: string;
}

/** The pack's smallest set holding every required service and no excluded one (manifest order on a tie).
 * `platformRequires`: services a set on this platform cannot do without (Android's window: its Activity starts the
 * host). `allServices`: the program reaches a name the pass cannot see, so every service is required. Throws when no
 * set qualifies. */
export function selectHostSet(options: {
  sets: readonly HostSetChoice[];
  reach: HostReach;
  request?: HostFeatureRequest;
  moduleServices?: Readonly<Record<string, readonly HostService[]>>;
  platformRequires?: readonly HostService[];
}): HostSelection {
  const request = options.request ?? { add: [], remove: [] };
  const excluded: HostService[] = HOST_SERVICES.filter((s) => request.remove.includes(s));
  const reasons: string[] = [];
  let wanted: HostService[];
  if (options.reach.opaque !== null) {
    wanted = [...HOST_SERVICES];
    reasons.push(`every service: ${options.reach.opaque.what} (${where(options.reach.opaque.loc)})`);
  } else {
    wanted = [...options.reach.services];
    for (const s of options.reach.services) {
      const f = options.reach.first[s];
      if (f !== undefined) reasons.push(`${s}: ${f.name} (${where(f.loc)})`);
    }
    for (const m of options.reach.modules) {
      const listed = options.moduleServices?.[m];
      const loc = options.reach.firstModule[m]!;
      if (listed === undefined) {
        wanted = [...HOST_SERVICES];
        reasons.push(`every service: host module ${m}, which the pack does not describe (${where(loc)})`);
      } else {
        wanted.push(...listed);
        if (listed.length > 0) reasons.push(`${listed.join(", ")}: host module ${m} (${where(loc)})`);
      }
    }
  }
  for (const s of request.add) {
    wanted.push(s);
    reasons.push(`${s}: --host-features`);
  }
  for (const s of options.platformRequires ?? []) {
    wanted.push(s);
    reasons.push(`${s}: the platform's host starts from it`);
  }
  // A removal wins: the program sees that service as absent. Its implications stay unless removed too.
  const required = closeHostServices(wanted.filter((s) => !excluded.includes(s))).filter((s) => !excluded.includes(s));
  const fits = options.sets.filter(
    (set) => required.every((s) => set.services.includes(s)) && !excluded.some((s) => set.services.includes(s)),
  );
  if (fits.length === 0) {
    throw new Error(
      `no set of the host pack holds ${required.length === 0 ? "no service" : required.join(", ")}` +
        `${excluded.length === 0 ? "" : ` without ${excluded.join(", ")}`}; the pack's sets: ` +
        options.sets.map((s) => `${s.name} (${s.services.length === 0 ? "none" : s.services.join(", ")})`).join(", "),
    );
  }
  const best = fits.reduce((a, b) => (b.services.length < a.services.length ? b : a));
  return {
    set: best.name,
    required,
    excluded: [...excluded],
    reason: reasons.length === 0 ? "no host service reached" : reasons.join("; "),
  };
}

function where(loc: SrcLoc): string {
  return `${loc.file}@${loc.start}`;
}
