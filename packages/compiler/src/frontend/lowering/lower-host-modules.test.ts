import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { compile } from "../../index.js";
import { isHostModuleScheme, setHostModuleSchemes } from "../browser-target.js";

afterEach(() => setHostModuleSchemes(undefined));

test("by default every scheme but node: is a host-module scheme", () => {
  setHostModuleSchemes(undefined);
  expect(isHostModuleScheme("host:fetch")).toBe(true);
  expect(isHostModuleScheme("app:gpu")).toBe(true);
  expect(isHostModuleScheme("node:fs")).toBe(false);
  expect(isHostModuleScheme("@scope/pkg")).toBe(false);
  expect(isHostModuleScheme("./local.js")).toBe(false);
});

test("hostModuleSchemes admits only the schemes it names, without regard to case or a trailing colon", () => {
  setHostModuleSchemes(["host", "App:"]);
  expect(isHostModuleScheme("host:fetch")).toBe(true);
  expect(isHostModuleScheme("app:gpu")).toBe(true);
  expect(isHostModuleScheme("other:gpu")).toBe(false);
  expect(isHostModuleScheme("node:fs")).toBe(false);
  setHostModuleSchemes(["node"]);
  expect(isHostModuleScheme("node:fs")).toBe(false);
});

/** A browser program calling one function of an ambient `host:clock` module. */
async function build(options: { hostModuleSchemes?: readonly string[] }): Promise<{ ok: boolean; typed: unknown }> {
  const dir = mkdtempSync(join(tmpdir(), "host-schemes-test-"));
  try {
    writeFileSync(join(dir, "clock.d.ts"), 'declare module "host:clock" {\n  export function ticks(scale: number): number;\n}\n');
    writeFileSync(join(dir, "main.ts"), '/// <reference path="./clock.d.ts" />\nimport { ticks } from "host:clock";\nconsole.log(ticks(2) > 0);\n');
    const out = join(dir, "main.wasm");
    const r = await compile(join(dir, "main.ts"), { outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native", ...options });
    const sidecar = `${out}.host-modules.json`;
    return { ok: r.ok, typed: existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, "utf8")) : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a typed host module of an admitted scheme is a wasm import typed by its declaration", async () => {
  const typed = await build({});
  expect(typed.ok).toBe(true);
  expect(typed.typed).toEqual([{ module: "host:clock", name: "ticks", params: ["number"], result: "number" }]);
  const named = await build({ hostModuleSchemes: ["host"] });
  expect(named.typed).toEqual(typed.typed);
}, 240000);

test("a scheme hostModuleSchemes leaves out stays on the untyped page-module path", async () => {
  const other = await build({ hostModuleSchemes: ["app"] });
  expect(other.ok).toBe(true);
  expect(other.typed).toBeNull();
}, 240000);
