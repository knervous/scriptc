import { describe, expect, test } from "vitest";
import { hostCacheIdentity, hostPackPlatform, hostPackSets, linksHostIsland, moduleCallsHost, parseHostPackManifest } from "./host-island.js";
import { isCompanionPackage, resolveCompanionPackageJson, scriptwPackageAlias } from "./scriptw-packages.js";

describe("host island choice", () => {
  test("a page program links the host island unless the host is quickjs", () => {
    expect(linksHostIsland({ browser: true, callsHost: false })).toBe(true);
    expect(linksHostIsland({ browser: false, callsHost: true })).toBe(true);
    expect(linksHostIsland({ browser: false, callsHost: false })).toBe(false);
    expect(linksHostIsland({ browser: true, callsHost: true, host: "quickjs" })).toBe(false);
    expect(linksHostIsland({ browser: true, callsHost: false, host: "headless" })).toBe(true);
  });

  test("a host.call anywhere in the module reaches the host", () => {
    const call = { kind: "libCall", fn: "host.call", args: [], type: { kind: "void" } };
    const fn = (body: unknown[]) => ({ body }) as never;
    expect(moduleCallsHost({ functions: [fn([{ kind: "exprStmt", expr: call }])] } as never)).toBe(true);
    expect(moduleCallsHost({ functions: [fn([])] } as never)).toBe(false);
  });

  test("host packs exist for the fork's five platforms", () => {
    expect(hostPackPlatform({ name: "linux-x64-gnu" } as never)).toBe("linux-x64-gnu");
    expect(hostPackPlatform({ name: "windows-x64-msvc" } as never)).toBe("win32-x64");
    expect(hostPackPlatform({ name: "macos-arm64" } as never)).toBe("darwin-arm64");
    expect(hostPackPlatform({ name: "macos-x64" } as never)).toBe("darwin-x64");
    expect(hostPackPlatform({ name: "android-arm64" } as never)).toBe("android-arm64");
    expect(hostPackPlatform({ name: "linux-arm64-musl" } as never)).toBeNull();
  });

  test("a host pack manifest names its ABI, target, archives and link arguments", () => {
    const sha256 = "0".repeat(64);
    const good = { schema: "scriptw.host-pack.v1", abi: 3, target: "x86_64-unknown-linux-gnu", archives: { generic: { path: "a/lib.a", sha256 } }, linkArgs: ["-ldl"] };
    expect(parseHostPackManifest(good, "m").abi).toBe(3);
    expect(parseHostPackManifest({ ...good, exports: ["JNI_OnLoad", "Java_a_b"] }, "m").exports).toEqual(["JNI_OnLoad", "Java_a_b"]);
    for (const bad of [
      { ...good, schema: "other" },
      { ...good, abi: 3.5 },
      { ...good, archives: { other: { path: "a", sha256 } } },
      { ...good, archives: { generic: { path: "../escape.a", sha256 } } },
      { ...good, archives: { generic: { path: "a", sha256: "short" } } },
      { ...good, linkArgs: [1] },
      { ...good, exports: ["Java_ok", "bad name"] },
    ]) expect(() => parseHostPackManifest(bad, "m")).toThrow(/not a valid host pack manifest/);
  });

  test("a v2 manifest names its sets, each with its archive and services; v1 reads as full and headless", () => {
    const sha256 = "0".repeat(64);
    const v2 = {
      schema: "scriptw.host-pack.v2", abi: 3, target: "x86_64-pc-windows-gnullvm", linkArgs: [],
      sets: { full: { path: "a/full.a", sha256, services: ["window", "gpu", "audio", "net", "rtc"] }, offline: { path: "a/off.a", sha256, services: [] } },
      modules: { "host:demo": ["net"] },
    };
    expect(hostPackSets(parseHostPackManifest(v2, "m")).map((s) => [s.name, s.services.length])).toEqual([["full", 5], ["offline", 0]]);
    for (const bad of [
      { ...v2, sets: {} },
      { ...v2, sets: { full: { path: "a", sha256, services: ["sound"] } } },
      { ...v2, sets: { auto: { path: "a", sha256, services: [] } } },
      { ...v2, sets: { full: { path: "../a", sha256, services: [] } } },
      { ...v2, modules: { "host:demo": ["sound"] } },
    ]) expect(() => parseHostPackManifest(bad, "m")).toThrow(/not a valid host pack manifest/);
    const v1 = { schema: "scriptw.host-pack.v1", abi: 3, target: "t", linkArgs: [], archives: { generic: { path: "g.a", sha256 }, headless: { path: "h.a", sha256 } } };
    expect(hostPackSets(parseHostPackManifest(v1, "m")).map((s) => [s.name, s.path, s.services])).toEqual([
      ["full", "g.a", ["window", "gpu", "audio", "net", "rtc"]],
      ["headless", "h.a", ["net"]],
    ]);
  });

  test("the default host posture (auto) adds nothing to the executable cache key", () => {
    expect(hostCacheIdentity({}, {})).toBeUndefined();
    expect(hostCacheIdentity({ host: "auto" }, {})).toBeUndefined();
    expect(hostCacheIdentity({ host: "generic" }, {})).toBe("choice=full");
    expect(hostCacheIdentity({ host: "full" }, {})).toBe("choice=full");
    expect(hostCacheIdentity({ host: "headless" }, {})).toBe("choice=headless");
    expect(hostCacheIdentity({ hostFeatures: ["audio", "-rtc"] }, {})).toBe("features=audio,-rtc");
    expect(hostCacheIdentity({}, { SCRIPTC_HOST_FEATURES: "net" })).toBe("SCRIPTC_HOST_FEATURES=net");
    expect(hostCacheIdentity({}, { SCRIPTW_HOST_PACK: "/p" })).toBe("SCRIPTW_HOST_PACK=/p");
    expect(hostCacheIdentity({ host: "headless" }, {})).not.toBe(hostCacheIdentity({ host: "quickjs" }, {}));
  });
});

describe("@scriptw companion names", () => {
  test("the fork's names stand for upstream's, Windows without -msvc", () => {
    expect(scriptwPackageAlias("@scriptc/runtime-win32-x64-msvc")).toBe("@scriptw/runtime-win32-x64");
    expect(scriptwPackageAlias("@scriptc/llvm-darwin-arm64")).toBe("@scriptw/llvm-darwin-arm64");
    expect(scriptwPackageAlias("@scriptc/runtime-linux-arm64-musl")).toBeNull();
    expect(isCompanionPackage("@scriptw/runtime-android-arm64", "@scriptc/runtime-android-arm64")).toBe(true);
    expect(isCompanionPackage("@scriptc/runtime-android-arm64", "@scriptc/runtime-android-arm64")).toBe(true);
    expect(isCompanionPackage("@other/runtime-android-arm64", "@scriptc/runtime-android-arm64")).toBe(false);
  });

  test("the override directory, then the @scriptw name, then upstream's", () => {
    const join = (...parts: string[]) => parts.join("/");
    const installed = (names: string[]) => (spec: string) => {
      if (names.some((n) => spec === `${n}/package.json`)) return `/nm/${spec}`;
      throw new Error("not found");
    };
    const upstream = "@scriptc/runtime-linux-x64-gnu";
    expect(resolveCompanionPackageJson(upstream, installed([upstream]), "/dir", join)).toBe("/dir/package.json");
    expect(resolveCompanionPackageJson(upstream, installed([upstream, "@scriptw/runtime-linux-x64-gnu"]), undefined, join))
      .toBe("/nm/@scriptw/runtime-linux-x64-gnu/package.json");
    expect(resolveCompanionPackageJson(upstream, installed([upstream]), undefined, join)).toBe(`/nm/${upstream}/package.json`);
    expect(() => resolveCompanionPackageJson(upstream, installed([]), undefined, join)).toThrow();
  });
});
