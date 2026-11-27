import { describe, expect, test } from "vitest";
import { closeHostServices, hostReach, parseHostFeatures, selectHostSet, type HostReach, type HostSetChoice } from "./host-features.js";

const loc = { file: "/p/main.ts", start: 0, end: 1 };
const t = { kind: "dyn" };
const globalGet = (name: string) => ({ kind: "jsOp", op: "globalGet", name, args: [], type: t, loc });
const member = (op: string, name: string, receiver: unknown, ...args: unknown[]) => ({ kind: "jsOp", op, name, args: [receiver, ...args], type: t, loc });
const lib = (fn: string, ...args: unknown[]) => ({ kind: "libCall", fn, args, type: t, loc });
const str = (value: string) => ({ kind: "strLit", value, type: { kind: "string" }, loc });
const program = (...exprs: unknown[]) =>
  ({ functions: [{ name: "%main", loc, body: exprs.map((expr) => ({ kind: "exprStmt", expr, loc })) }] }) as never;

const SETS: HostSetChoice[] = [
  { name: "full", services: ["window", "gpu", "audio", "net", "rtc"] },
  { name: "ui", services: ["window", "gpu", "net"] },
  { name: "headless", services: ["net"] },
  { name: "offline", services: [] },
];
const choose = (reach: HostReach, extra: Partial<Parameters<typeof selectHostSet>[0]> = {}) =>
  selectHostSet({ sets: SETS, reach, ...extra }).set;

describe("the services a program reaches", () => {
  test("the document, timers and storage are the core's", () => {
    const reach = hostReach(program(
      member("callMethod", "createElement", globalGet("document"), str("div")),
      member("callMethod", "call", globalGet("setTimeout")),
      globalGet("requestAnimationFrame"),
      member("callMethod", "setItem", globalGet("localStorage"), str("k"), str("v")),
    ));
    expect(reach.services).toEqual([]);
    expect(reach.opaque).toBeNull();
    expect(choose(reach)).toBe("offline");
  });

  test("each service from its names", () => {
    const cases: [unknown, string[]][] = [
      [member("callMethod", "getContext", globalGet("document"), str("2d")), ["window"]],
      [member("callMethod", "createElement", globalGet("document"), str("CANVAS")), ["window"]],
      [globalGet("matchMedia"), ["window"]],
      [member("getProp", "clipboard", globalGet("navigator")), ["window"]],
      [member("getProp", "gpu", globalGet("navigator")), ["gpu"]],
      [globalGet("AudioContext"), ["audio"]],
      [globalGet("RTCPeerConnection"), ["rtc"]],
      [globalGet("fetch"), ["net"]],
      [lib("fetch.start", str("u")), ["net"]],
      [member("callMethod", "sendBeacon", globalGet("navigator"), str("u")), ["net"]],
    ];
    for (const [expr, services] of cases) expect(hostReach(program(expr)).services).toEqual(services);
  });

  test("a static member of the global object reads as that global", () => {
    const reach = hostReach(program(member("callMethod", "fetch", globalGet("window"), str("u"))));
    expect(reach.services).toEqual(["net"]);
    expect(reach.opaque).toBeNull();
    expect(choose(reach)).toBe("headless");
    expect(hostReach(program(member("getProp", "AudioContext", globalGet("globalThis")))).services).toEqual(["audio"]);
  });

  test("a read the pass cannot name needs every service", () => {
    for (const expr of [
      member("getIdx", undefined as never, globalGet("window"), str("fetch")),
      globalGet("globalThis"),
      lib("global.native", { kind: "arrayLit", elems: [], type: t, loc }),
      lib("dyn.globalHas", str("x")),
      lib("global.bindingRead", { kind: "varRef", localId: "k", type: t, loc }),
    ]) {
      const reach = hostReach(program(expr));
      expect(reach.opaque).not.toBeNull();
      expect(choose(reach)).toBe("full");
    }
    expect(hostReach(program(lib("global.bindingRead", str("AudioContext")))).services).toEqual(["audio"]);
  });

  test("a typed host module needs the services the pack lists for it, else every service", () => {
    const reach = hostReach(program(lib("host.call", str("host:demo"), str("add"))));
    expect(reach.modules).toEqual(["host:demo"]);
    expect(choose(reach)).toBe("full");
    expect(choose(reach, { moduleServices: { "host:demo": [] } })).toBe("offline");
    expect(choose(reach, { moduleServices: { "host:demo": ["net"] } })).toBe("headless");
  });
});

describe("the set a program links", () => {
  const none: HostReach = { services: [], modules: [], opaque: null, first: {}, firstModule: {} };
  test("implications close the required services", () => {
    expect(closeHostServices(["window"])).toEqual(["window", "gpu"]);
    expect(closeHostServices(["rtc"])).toEqual(["net", "rtc"]);
    expect(choose({ ...none, services: ["window"] })).toBe("ui");
    expect(choose({ ...none, services: ["rtc"] })).toBe("full");
  });

  test("--host-features adds and removes; a removal wins", () => {
    expect(choose(none, { request: parseHostFeatures(["net"]) })).toBe("headless");
    expect(choose({ ...none, services: ["window", "audio"] }, { request: parseHostFeatures(["-audio"]) })).toBe("ui");
    expect(() => choose({ ...none, services: ["window"] }, { request: parseHostFeatures(["-net"]) })).toThrow(/no set of the host pack holds window, gpu without net/);
    expect(() => parseHostFeatures(["sound"])).toThrow(/unknown host service 'sound'/);
    expect(parseHostFeatures(["audio,-rtc", "+net"])).toEqual({ add: ["audio", "net"], remove: ["rtc"] });
  });

  test("a platform's required services, and a tie in manifest order", () => {
    expect(choose(none, { platformRequires: ["window"] })).toBe("ui");
    const tied: HostSetChoice[] = [{ name: "a", services: ["net"] }, { name: "b", services: ["audio"] }];
    expect(selectHostSet({ sets: tied, reach: none }).set).toBe("a");
  });

  test("the reason names the first reach of each service", () => {
    const reach = hostReach(program(globalGet("fetch"), globalGet("AudioContext")));
    expect(selectHostSet({ sets: SETS, reach }).reason).toBe("audio: AudioContext (/p/main.ts@0); net: fetch (/p/main.ts@0)");
  });
});
