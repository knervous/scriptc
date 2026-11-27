import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile } from "../../index.js";

/** The SC-coded fences a compile records in its receipt (`<out>.fences.json`, written only when there are some). */
async function fenceCodes(ctorBody: string): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "super-guard-test-")), out = join(dir, "main.wasm");
  writeFileSync(join(dir, "main.ts"), [
    "class Base { n: number; constructor(n: number) { this.n = n; } }",
    `class Derived extends Base { tag: string; constructor(flag: boolean) { ${ctorBody} } }`,
    "console.log(new Derived(true).n, new Derived(false).tag);",
  ].join("\n") + "\n");
  const r = await compile(join(dir, "main.ts"), { outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native" });
  expect(r.ok ? [] : r.diagnostics.map((d) => d.message)).toEqual([]);
  // No receipt file: no fences.
  if (!existsSync(`${out}.fences.json`)) return [];
  const receipt = JSON.parse(readFileSync(`${out}.fences.json`, "utf8")) as { frontend: { code: string }[] };
  return receipt.frontend.map((f) => f.code);
}

test("a constructor's only super() statement carries no repeated-super guard", async () => {
  expect(await fenceCodes('super(flag ? 1 : 2); this.tag = "t";')).not.toContain("SC2020");
});

test("super() calls on the exclusive arms of an if/else carry no guard (one runs per construction)", async () => {
  expect(await fenceCodes('if (flag) super(1); else super(2); this.tag = "t";')).not.toContain("SC2020");
  expect(await fenceCodes('if (flag) { super(1); } else if (flag === false) { super(2); } else { super(3); } this.tag = "t";')).not.toContain("SC2020");
});

test("super() calls that can both run keep the guard (a second call could run)", async () => {
  expect(await fenceCodes('super(0); if (flag) super(1); this.tag = "t";')).toContain("SC2020");
  expect(await fenceCodes('try { super(1); } catch { super(2); } this.tag = "t";')).toContain("SC2020");
  expect(await fenceCodes('super(0); for (let i = 0; i < 0; i++) super(i); this.tag = "t";')).toContain("SC2020");
});

/** A release build of the same constructor: its diagnostics. */
async function releaseDiagnostics(ctorBody: string): Promise<{ message: string; start: number }[]> {
  const dir = mkdtempSync(join(tmpdir(), "super-guard-release-")), out = join(dir, "main.wasm");
  writeFileSync(join(dir, "main.ts"), [
    "class Base { n: number; constructor(n: number) { this.n = n; } }",
    `class Derived extends Base { tag: string; constructor(flag: boolean) { ${ctorBody} } }`,
    "console.log(new Derived(true).n, new Derived(false).tag);",
  ].join("\n") + "\n");
  const r = await compile(join(dir, "main.ts"), { outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native", release: true });
  return r.ok ? [] : r.diagnostics.map((d) => ({ message: d.message, start: d.loc?.start ?? -1 }));
}

test("a release build refuses the repeated-super guard (an expression fence) at the super() call's own span", async () => {
  const body = 'super(0); if (flag) super(1); this.tag = "t";';
  const refused = await releaseDiagnostics(body);
  expect(refused.map((d) => d.message)).toEqual([expect.stringContaining("SC2020"), expect.stringContaining("SC2020")]);
  const prefix = "class Base { n: number; constructor(n: number) { this.n = n; } }\nclass Derived extends Base { tag: string; constructor(flag: boolean) { ";
  expect(refused.map((d) => d.start)).toEqual([prefix.length + body.indexOf("super(0)"), prefix.length + body.indexOf("super(1)")]);
  expect(await releaseDiagnostics('if (flag) super(1); else super(2); this.tag = "t";')).toEqual([]);
});
