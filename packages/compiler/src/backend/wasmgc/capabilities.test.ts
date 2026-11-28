import { expect, test } from "vitest";
import {
  appendCustomSection, BASELINE_MODE, CAPABILITY_SECTION, capabilitiesOfBytes, capabilityKey, decodeCapabilitySection, detectCapabilities,
  encodeCapabilitySection, mergeCapabilityRecords, missingRequirements, modeOfKey, parseCapabilities, parseTargets, planVariants,
  preferredMode, PROBES, readCustomSections, refusalText, requirementsOf, resolvedRecord, targetsLacking, type CapabilityUses,
} from "./capabilities.js";

const WebAssembly = (globalThis as unknown as { WebAssembly: { validate(b: Uint8Array): boolean; Module: { new (b: Uint8Array): object; customSections(m: object, n: string): ArrayBuffer[] } } }).WebAssembly;
const NONE: CapabilityUses = { byteViews: false, memory: false, jspi: false, relaxedSimd: false, simd: false, sharedMemory: false };
const EMPTY_MODULE = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

test("the canonical key spells the mode and reads back", () => {
  expect(capabilityKey(BASELINE_MODE)).toBe("wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=off");
  const mode = { eh: "legacy", views: "fixed:64", relaxedSimd: true, threads: "auto" } as const;
  expect(modeOfKey(capabilityKey(mode))).toEqual(mode);
  expect(modeOfKey("wgc-cap/2;eh=exnref")).toBeNull();
});

test("capability lists parse, and unknown entries are errors", () => {
  expect(parseCapabilities("baseline,eh=legacy,views=fixed:128,relaxed-simd,threads=auto,-jspi")).toEqual({
    request: { preset: "baseline", eh: "legacy", views: "fixed:128", relaxedSimd: true, threads: "auto", jspi: false }, errors: [] });
  expect(parseCapabilities("views=fixed").request.views).toBe("fixed:256");
  expect(parseCapabilities("views=fixed:0").errors).toHaveLength(1);
  expect(parseCapabilities("simd=off").errors).toHaveLength(1);
  expect(preferredMode({ preset: "compat" })).toEqual({ eh: "legacy", views: "fixed:256", relaxedSimd: false, threads: "off" });
});

test("targets parse and compare by version", () => {
  const { targets, errors } = parseTargets("chrome>=137, node>=24, safari26.2");
  expect(errors).toEqual([]);
  expect(targetsLacking("exnref", targets).map(t => t.engine)).toEqual(["node"]);
  expect(targetsLacking("resizable-memory-buffer", targets).map(t => t.engine)).toEqual(["chrome", "node"]);
  expect(targetsLacking("relaxed-simd", parseTargets("safari>=99").targets)).toHaveLength(1);
  expect(parseTargets("ie>=11").errors).toHaveLength(1);
});

test("requirements follow the mode and what the module uses", () => {
  const views: CapabilityUses = { ...NONE, byteViews: true, memory: true, simd: true };
  expect(requirementsOf(BASELINE_MODE, views)).toContain("resizable-memory-buffer");
  expect(requirementsOf({ ...BASELINE_MODE, views: "fixed:16" }, views)).not.toContain("resizable-memory-buffer");
  expect(requirementsOf({ ...BASELINE_MODE, eh: "legacy" }, NONE)).toContain("legacy-eh");
  expect(requirementsOf(BASELINE_MODE, { ...NONE, sharedMemory: true })).toEqual(expect.arrayContaining(["shared-memory", "cross-origin-isolation"]));
});

test("auto plans a compat variant only when a target needs it and the program uses the feature", () => {
  const old = parseTargets("chrome>=137,node>=24.15").targets;
  const views: CapabilityUses = { ...NONE, byteViews: true, memory: true };
  expect(planVariants({ preset: "auto" }, BASELINE_MODE, NONE, old).compat).toBeNull();
  expect(planVariants({ preset: "auto" }, BASELINE_MODE, views, old).compat).toEqual({ eh: "exnref", views: "fixed:256", relaxedSimd: false, threads: "off" });
  expect(planVariants({ preset: "auto", views: "fixed:32" }, BASELINE_MODE, views, old).compat?.views).toBe("fixed:32");
  expect(planVariants({ preset: "baseline" }, BASELINE_MODE, views, old).compat).toBeNull();
  expect(planVariants({ preset: "auto" }, BASELINE_MODE, NONE, parseTargets("node>=22").targets).compat?.eh).toBe("legacy");
  // JSPI has no variant: a target without it is a build error.
  expect(planVariants({ preset: "auto" }, BASELINE_MODE, { ...NONE, jspi: true }, parseTargets("safari>=26.2").targets).errors[0]).toMatch(/JSPI/);
  expect(planVariants({ preset: "auto", jspi: false }, BASELINE_MODE, { ...NONE, jspi: true }, parseTargets("chrome>=137").targets).errors[0]).toMatch(/-jspi/);
});

test("the section round-trips, appends to a binary and reads back from raw bytes", () => {
  const record = resolvedRecord({ ...BASELINE_MODE, views: "fixed:8" }, { ...NONE, memory: true, simd: true }, "compat");
  expect(decodeCapabilitySection(encodeCapabilitySection(record))).toEqual(record);
  const bytes = appendCustomSection(EMPTY_MODULE, CAPABILITY_SECTION, encodeCapabilitySection(record));
  expect(WebAssembly.validate(bytes)).toBe(true);
  expect(capabilitiesOfBytes(bytes)).toEqual(record);
  expect(readCustomSections(bytes, "other")).toEqual([]);
  const engine = WebAssembly.Module.customSections(new WebAssembly.Module(bytes), CAPABILITY_SECTION)[0]!;
  expect(decodeCapabilitySection(engine)).toEqual(record);
});

test("merged records union their requirements and refuse different modes", () => {
  const a = resolvedRecord(BASELINE_MODE, NONE, "preferred"), b = resolvedRecord(BASELINE_MODE, { ...NONE, jspi: true }, "preferred");
  expect(mergeCapabilityRecords([a, b]).requires).toContain("jspi");
  expect(() => mergeCapabilityRecords([a, resolvedRecord({ ...BASELINE_MODE, eh: "legacy" }, NONE, "preferred")])).toThrow(/disagree/);
});

test("the probes are valid modules and detect this engine", () => {
  for (const bytes of Object.values(PROBES)) expect(() => new WebAssembly.Module(bytes)).not.toThrow();
  const caps = detectCapabilities(true);
  expect(caps["wasm-gc"] && caps["exnref"] && caps["legacy-eh"] && caps["simd"]).toBe(true);
  expect(missingRequirements(["wasm-gc", "js-string-builtins"], { ...caps, "js-string-builtins": false })).toEqual([]);
  expect(refusalText(["resizable-memory-buffer"])).toMatch(/Chrome 144.*Node 26.*--experimental-wasm-rab-integration/);
});

test("math=strict joins the key only when set, reads back, and refuses relaxed SIMD", () => {
  expect(capabilityKey({ ...BASELINE_MODE, math: "strict" })).toBe("wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=off;math=strict");
  expect(modeOfKey("wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=off;math=strict")).toEqual({ ...BASELINE_MODE, math: "strict" });
  expect(modeOfKey(capabilityKey(BASELINE_MODE))).toEqual(BASELINE_MODE);
  expect(modeOfKey("wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=off;math=fast")).toBe(null);
  expect(parseCapabilities("math=strict").request.math).toBe("strict");
  expect(parseCapabilities("math=exact").errors).toHaveLength(1);
  const strict = preferredMode(parseCapabilities("math=strict,relaxed-simd").request);
  expect(planVariants({ preset: "auto", math: "strict", relaxedSimd: true }, strict, NONE, []).errors.join()).toMatch(/math=strict refuses relaxed SIMD/);
});

test("a module importing the strict-math library is built math=strict and records its intrinsic libraries", () => {
  const uses: CapabilityUses = { byteViews: false, memory: false, jspi: false, relaxedSimd: false, simd: false, sharedMemory: false, intrinsics: ["int", "math"] };
  const record = resolvedRecord(BASELINE_MODE, uses, "preferred");
  expect(record.key).toMatch(/;math=strict$/);
  expect(record.intrinsics).toEqual(["int", "math"]);
  const decoded = decodeCapabilitySection(encodeCapabilitySection(record));
  expect(decoded?.intrinsics).toEqual(["int", "math"]);
  expect(decoded?.mode.math).toBe("strict");
  const explain = planVariants({ preset: "auto" }, BASELINE_MODE, uses, []).explain.join("\n");
  expect(explain).toMatch(/math: strict \(the program imports the strict-math library\); relaxed SIMD off; NaNs stored to memory canonical/);
  expect(explain).toMatch(/intrinsics: int: i32\/i64 instructions/);
});

test("a module on a shared link memory is built threads=shared and records it", () => {
  const uses: CapabilityUses = { ...NONE, memory: true, sharedMemory: true, intrinsics: ["atomics"] };
  const record = resolvedRecord(BASELINE_MODE, uses, "preferred");
  expect(record.key).toBe("wgc-cap/1;eh=exnref;views=resizable;relaxed=0;threads=shared");
  expect(record.mode.threads).toBe("shared");
  expect(record.requires).toEqual(expect.arrayContaining(["shared-memory", "cross-origin-isolation"]));
  expect(decodeCapabilitySection(encodeCapabilitySection(record))?.mode.threads).toBe("shared");
  const explain = planVariants({ preset: "auto" }, BASELINE_MODE, uses, []).explain.join("\n");
  expect(explain).toMatch(/preferred: wgc-cap\/1;eh=exnref;views=resizable;relaxed=0;threads=shared/);
  // threads=auto keeps its mode: the host picks per deployment.
  expect(resolvedRecord({ ...BASELINE_MODE, threads: "auto" }, uses, "preferred").mode.threads).toBe("auto");
  // An unshared memory stays threads=off.
  expect(resolvedRecord(BASELINE_MODE, { ...uses, sharedMemory: false }, "preferred").mode.threads).toBe("off");
});
