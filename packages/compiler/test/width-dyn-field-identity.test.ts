import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { compile } from "../src/index.js";

// A renderer's storage-texture binding, as a program's native lane compiles it: a resolver returning
// `{ _state: resource }` is installed into a `(...) => Resolved` slot whose `_state` is `any`, so the function adapter
// reshapes the result record and boxes the field. The field must box as a live typed reference, as the same value
// entering an `any` slot directly does: the checked read in the getter then recovers the original record (identity,
// its registry Set). A deep-copied snapshot gave the getter a fresh record and a fresh engine (the storage-texture
// "invalid resource" on every native ComputeBindingSet).
const source = `
declare const brand: unique symbol;
interface Engine { readonly name: string; epoch: number }
interface Texture { readonly [brand]?: true; readonly width: number; readonly _engine: Engine; _destroyed: boolean }
interface Resolved { readonly _state: any; readonly _dynamic?: { readonly _alignment: number } }
type Resolve = (engine: Engine, resource: any) => Resolved;
const live = new Set<Texture>();
function resolveTexture(engine: Engine, input: any) {
  const texture: Texture = input;
  if (texture._engine !== engine || !live.has(texture)) throw new Error("not live");
  return { _state: texture };
}
const resolvers: Resolve[] = [];
resolvers.push(resolveTexture);
const engine: Engine = { name: "main", epoch: 0 };
const created: Texture = { width: 64, _engine: engine, _destroyed: false };
live.add(created);
const state: Texture = resolvers[0]!(engine, created)._state;
console.log(state === created, live.has(state), state.width);
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

test("a record field boxed into an any field by a width copy keeps its identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-width-dyn-identity-"));
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
    // The resolver reaches the slot through the general function adapter, which reshapes its result record.
    expect(ll).toMatch(/@sc_f__x25_fn_adapt_[0-9a-f]+\(/);
    const helpers = [...ll.matchAll(/^define [^\n]*@(sc_bf__x25_rec_width_[0-9a-f]+)\([^\n]*\n([\s\S]*?)^}/gm)];
    expect(helpers.length).toBeGreaterThan(0);
    for (const [, , body] of helpers) {
      // The texture field boxes by reference (the typed-reference capsule), never through a to-dyn snapshot copy.
      expect(body).toContain("@scr_dyn_new_typed_ref");
      expect(body).not.toMatch(/call ptr @sc_td_\d+\(/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
