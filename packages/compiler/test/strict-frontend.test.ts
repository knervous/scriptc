/* The strict frontend (CompileBaseOptions.strictFrontend; frontend/program.ts REQUIRED_STRICT_FLAGS): the strict family
 * the lowering relies on is required whatever the tsconfig says, and the opt-in parts force noImplicitAny, trap an
 * unpinned `any` at the site it would lower to a dynamic value (SC1200), and force the stricter indexed/optional flags. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";
import type { CompileBaseOptions } from "../src/compile-types.js";

const fixtures = fileURLToPath(new URL("./fixtures/fix-1127-strict-frontend/", import.meta.url));
// The lane where `any` lowers to checked dynamic values (the trap's subject): browser, native dyn, native any.
const nativeAny = { outputKind: "wasmgc", browser: true, dynModel: "native", experimentalTsNativeAny: true } as const;

async function build(fixture: string, extra: Partial<CompileBaseOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-strict-frontend-"));
  try {
    const r = await compile(join(fixtures, fixture, "main.ts"), { ...nativeAny, outDir: dir, outPath: join(dir, "o.wasm"), ...extra });
    return { ok: r.ok, diagnostics: r.diagnostics ?? [] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const codes = (ds: readonly { code: string }[]) => ds.map((d) => d.code);

describe("the strict family is required", () => {
  test("a tsconfig turning members off fails with SC0002 naming each", async () => {
    const r = await build("family-off");
    expect(r.ok).toBe(false);
    const floor = r.diagnostics.filter((d) => d.code === "SC0002").map((d) => d.message);
    expect(floor).toHaveLength(2);
    expect(floor[0]).toContain("disables strictFunctionTypes, which scriptc requires");
    expect(floor[1]).toContain("disables useUnknownInCatchVariables, which scriptc requires");
  });
  test("noImplicitAny stays the project's by default", async () => {
    const r = await build("implicit-any");
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  });
});

describe("strictFrontend", () => {
  test("trap: each unpinned any that lowers dynamically is refused at its site", async () => {
    const r = await build("implicit-any", { strictFrontend: { trap: true } });
    expect(r.ok).toBe(false);
    const trapped = r.diagnostics.filter((d) => d.code === "SC1200");
    expect(trapped.map((d) => d.message.match(/'([^']+)' has type 'any' from ([a-z ]+),/)?.slice(1)).sort()).toEqual([
      ["a", "an unannotated parameter"],
      ["later", "an unannotated binding"],
    ]);
    expect(codes(r.diagnostics).every((c) => c === "SC1200")).toBe(true);
  });
  test("true: noImplicitAny is forced, so the checker names the implicit parameter", async () => {
    const r = await build("implicit-any", { strictFrontend: true });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === "SC0001" && d.message.includes("Parameter 'a' implicitly has an 'any' type"))).toBe(true);
  });
  test("noUncheckedIndexedAccess is forced on request", async () => {
    expect((await build("indexed")).ok).toBe(true);
    const r = await build("indexed", { strictFrontend: { noUncheckedIndexedAccess: true } });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === "SC0001" && d.message.includes("'number | undefined' is not assignable to type 'number'"))).toBe(true);
  });
});
