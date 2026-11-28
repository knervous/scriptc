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

test("a callback parameter crosses as a host function that calls the compiled closure through a typed trampoline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "host-callback-test-"));
  try {
    writeFileSync(join(dir, "events.d.ts"), [
      'declare module "host:events" {',
      "  export function listen(channel: number, onEvent: (kind: number, flag: boolean, name: string) => number): void;",
      "  export function notify(onDone: () => void): void;",
      "}", ""].join("\n"));
    writeFileSync(join(dir, "main.ts"), [
      '/// <reference path="./events.d.ts" />',
      'import { listen, notify } from "host:events";',
      "let total = 0, done = 0, names = \"\";",
      "const onEvent = (kind: number, flag: boolean, name: string): number => { total += flag ? kind : -kind; names += name; return total; };",
      "listen(7, onEvent);",
      "listen(8, onEvent);",
      "notify(() => { done++; });",
      "export function state(): string { return `${total} ${done} ${names}`; }", ""].join("\n"));
    const out = join(dir, "main.wasm");
    const r = await compile(join(dir, "main.ts"), { outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native", strictHostModules: true, wasmLink: { exports: ["state"] } });
    expect(r.ok).toBe(true);
    const typed = JSON.parse(readFileSync(`${out}.host-modules.json`, "utf8")) as { name: string; params: string[] }[];
    expect(typed.find((d) => d.name === "listen")!.params).toEqual(["number", "callback:hostcb.nbs_n:number,boolean,string:number"]);
    expect(typed.find((d) => d.name === "notify")!.params).toEqual(["callback:hostcb._v::void"]);
    const { instantiateLinked } = await import("../../backend/wasmgc/host.js");
    const seen: Function[] = [];
    let onDone: Function | null = null;
    const linked = await instantiateLinked(readFileSync(out), { "": {} }, {
      "host:events": { listen: (_channel: number, f: Function) => { seen.push(f); }, notify: (f: Function) => { onDone = f; } },
    });
    await linked.modules[""]!.main();
    // The same closure is the same host function, and its result comes back typed.
    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]!(5, true, "a")).toBe(5);
    expect(seen[0]!(2, false, "b")).toBe(3);
    // Arguments are converted to the declared kinds.
    expect(seen[0]!("4", 1, 9)).toBe(7);
    expect(onDone!()).toBeUndefined();
    expect((linked.modules[""]!.exports.state as () => string)()).toBe("7 1 ab9");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 240000);
