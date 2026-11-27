import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { compile } from "../src/index.js";

// A for-of element is typed `T | undefined` once lowered (a hole reads undefined), as are `find` results, Map lookups
// and optional fields. Such a value passed into an `unknown` parameter must box its record arm as a live typed
// reference, as the same `T` passed directly does, so `input as T` recovers the original record (identity, registry
// keys, writes). A to-dyn snapshot of the union gave every for-of element a fresh copy.
const source = `
interface Item { readonly name: string; hits: number }
const live = new Set<Item>();
function check(input: unknown): boolean {
  const item = input as Item;
  item.hits++;
  return live.has(item);
}
const a: Item = { name: "a", hits: 0 };
const b: Item = { name: "b", hits: 0 };
live.add(a);
live.add(b);
for (const item of [a, b]) console.log(check(item));
const items: Item[] = [a, b];
for (const item of items) console.log(check(item));
console.log(check(items.find((item) => item.name === "b")));
const known: unknown = a;
for (const item of items) console.log(known === item);
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

// The plain native lane, and the client's LLVM native-any lane.
for (const [lane, browser] of [["plain native", false], ["client native-any", true]] as const) {
  test(`a union-typed record element boxes into unknown by reference (${lane} lane)`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptc-union-dyn-identity-"));
    try {
      const entry = join(dir, "main.ts");
      const outPath = join(dir, "main.ll");
      await writeFile(entry, source);
      const result = await compile(entry, {
        outDir: dir, outPath, outputKind: "llvm", optimization: "release", conditions: ["wasmgc"],
        browser, dynModel: "native", hostHandles: browser, interfaceClassArms: true, experimentalTsNativeAny: true,
      });
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      const ll = await readFile(outPath, "utf8");
      // Every union value crosses through the live union adapter, whose record arm is the typed-reference capsule.
      const adapters = [...ll.matchAll(/^define internal ptr @(sc_ldu_\d+)\(ptr %u\)[^\n]*\n([\s\S]*?)^}/gm)];
      expect(adapters.length).toBeGreaterThan(0);
      for (const [, , body] of adapters) expect(body).toContain("@scr_dyn_new_typed_ref");
      const name = adapters[0]![1]!;
      // Both loops, the find result and the equality.
      expect(ll.match(new RegExp(`call ptr @${name}\\(`, "g"))?.length ?? 0).toBeGreaterThanOrEqual(4);
      // No union holding a record takes the to-dyn snapshot copy.
      for (const [, body] of ll.matchAll(/^define internal ptr @sc_td_\d+\([^\n]*; to-dyn union:[^\n]*\n([\s\S]*?)^}/gm)) {
        expect(body).not.toContain("; record");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
