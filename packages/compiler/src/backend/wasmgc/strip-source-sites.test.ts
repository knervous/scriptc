import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile } from "../../index.js";

/** Every string constant a module carries: its imports from module "'" (each name is the text). */
function stringConstants(bytes: Uint8Array): string[] {
  const wa = (globalThis as unknown as { WebAssembly: { Module: { new (b: Uint8Array, o?: unknown): object; imports(m: object): { module: string; name: string }[] } } }).WebAssembly;
  const module = new wa.Module(bytes, { builtins: ["js-string"] });
  return wa.Module.imports(module).filter((i) => i.module === "'").map((i) => i.name);
}

async function build(stripSourceSites: boolean): Promise<{ dir: string; strings: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "strip-sites-test-"));
  // A page value checked into a union: its mismatch message names the source site.
  writeFileSync(join(dir, "main.ts"), [
    "const page: any = globalThis;",
    "const value: string | number = page.appValue ?? 1;",
    // An asserted narrowing the checker cannot prove: its refusal names the slot type and the site.
    "type Account = { email: string; token: string };",
    "const maybe: Account | undefined = page.appAccount;",
    "const account = maybe as Account;",
    "console.log(typeof value, typeof account);",
  ].join("\n") + "\n");
  const out = join(dir, "main.wasm");
  const r = await compile(join(dir, "main.ts"), { outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native", stripSourceSites });
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics).slice(0, 600));
  const strings = stringConstants(new Uint8Array(readFileSync(out)));
  return { dir, strings };
}

test("by default a union check's message names its source site", async () => {
  const { strings } = await build(false);
  expect(strings.some((s) => /\bat \S*main\.ts:\d+/.test(s))).toBe(true);
}, 240000);

// Production builds: no absolute path, file name or `at <file>:<line>` site in the binary's runtime text.
test("stripSourceSites leaves no source path in the string constants", async () => {
  const { dir, strings } = await build(true);
  expect(strings.filter((s) => s.includes(dir) || /\bat \S+\.ts:\d+/.test(s))).toEqual([]);
}, 240000);
