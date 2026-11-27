import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { compile } from "../src/index.js";

// The browser frontend lowers a Date's members to its host-backed forms (date.hostStr / date.hostNum), which the
// LLVM lane answers with the runtime's date functions over the time value. Upstream's backend keeps a Date as an
// object (ScrDate), so the receiver's time value is read from it: passing the object itself gave
// `call ptr @scr_date_to_iso(double <ptr>)`, IR that LLVM rejects (a native host program's
// `at: new Date().toISOString()` in zone-packets.ts).
const source = `
declare global { var __loadState: unknown; }
globalThis.__loadState = { zone: 3, at: new Date().toISOString() };
const d = new Date(Date.UTC(2020, 1, 3, 4, 5, 6));
console.log(d.toISOString(), d.getUTCFullYear(), d.getUTCMonth(), d.getTime(), String(d).length > 0);
export {};
`;

const saved = { ...process.env };
beforeEach(() => {
  process.env["SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY"] = "1";
  process.env["SCRIPTC_EXPERIMENT_LLVM_VERSION"] ??= "22.1.8";
});
afterEach(() => {
  for (const key of ["SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY", "SCRIPTC_EXPERIMENT_LLVM_VERSION"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("the browser lane's host-backed Date members take the Date's time value", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-browser-date-host-"));
  try {
    const entry = join(dir, "main.ts");
    const outPath = join(dir, "main.ll");
    await writeFile(entry, source);
    const result = await compile(entry, {
      outDir: dir, outPath, outputKind: "llvm", optimization: "release", conditions: ["wasmgc"],
      browser: true, dynModel: "native", hostHandles: true, interfaceClassArms: true, experimentalTsNativeAny: true,
    });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    const ll = await readFile(outPath, "utf8");
    // Function by function (SSA names repeat across functions): every time value the date functions take is a
    // double, never a Date object's pointer.
    let isoCalls = 0;
    for (const [body] of ll.matchAll(/^define [^\n]*\{[^\n]*\n[\s\S]*?^\}/gm)) {
      const pointers = new Set([...body.matchAll(/^\s*(%[\w.]+) = (?:call|load) ptr\b/gm)].map((m) => m[1]));
      for (const [, fn, operand] of body.matchAll(/call \w+ @(scr_date_[a-z_]+)\(double (%[\w.]+)/g)) {
        if (fn === "scr_date_to_iso") isoCalls++;
        expect(pointers.has(operand), `${fn}(${operand})`).toBe(false);
      }
    }
    expect(isoCalls).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
