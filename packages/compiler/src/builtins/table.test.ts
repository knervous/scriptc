import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTINS, builtinFunction, builtinMethod } from "./table.js";

// The table's `impl` flags must match what the WasmGC emitter implements, so the
// table cannot drift from the backend: read the emitter's own case labels.
const emitter = readFileSync(fileURLToPath(new URL("../backend/wasmgc/emitter.ts", import.meta.url)), "utf8");
const body = (marker: string): string => {
  const start = emitter.indexOf(marker);
  const next = emitter.slice(start + marker.length).search(/\n {2}const [A-Za-z]+ = /);
  return emitter.slice(start, start + marker.length + next);
};
const cases = (src: string) => new Set([...src.matchAll(/case "([A-Za-z]+)"/g)].map(m => m[1]!));

describe("builtin table", () => {
  it("lists each receiver's method once", () => {
    const keys = BUILTINS.map(b => `${b.receiver}.${b.method}`);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("marks exactly the array methods the emitter implements in Wasm", () => {
    const wasm = cases(body("const arrayMethodCallInner = "));
    expect(wasm.size).toBeGreaterThan(15); // the parse found the emitter's switch
    const modeled = BUILTINS.filter(b => b.receiver === "array");
    for (const b of modeled) expect([b.method, b.impl.wasm]).toEqual([b.method, wasm.has(b.method)]);
    // An emitter method the table lacks would be unmodeled in the analysis.
    for (const m of wasm) if (m !== "toString") expect([m, builtinMethod("array", m) !== undefined]).toEqual([m, true]);
  });

  it("drives the emitter's direct callback walks", () => {
    // The emitter derives DIRECT_ARRAY_METHODS from impl.direct; a direct walk exists per arrIterDirect kind or reduce.
    expect(emitter).toContain("const DIRECT_ARRAY_METHODS = directArrayMethods;");
    const direct = BUILTINS.filter(b => b.receiver === "array" && b.impl.direct).map(b => b.method).sort();
    expect(direct).toEqual(["every", "filter", "find", "findIndex", "forEach", "map", "reduce", "some"]);
    for (const m of direct) expect([m, BUILTINS.find(b => b.receiver === "array" && b.method === m)!.flow.callback !== undefined]).toEqual([m, true]);
  });

  it("gives callbacks the parameters JS passes", () => {
    expect(builtinMethod("array", "reduce")!.flow.callback!.params).toEqual(["accumulator", "element", "index", "receiver"]);
    expect(builtinMethod("array", "map")!.flow.returns).toEqual([{ fresh: ["callbackResult"] }]);
    expect(builtinMethod("number", "toFixed")!.flow.returns).toEqual(["str"]);
    expect(builtinFunction("Math.floor")!.flow.returns).toEqual(["int"]);
    expect(builtinFunction("Object.assign")!.flow.copiesFields).toBe(true);
  });
});
