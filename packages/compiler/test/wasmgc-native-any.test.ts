import { expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../src/index.js";
import { nativeAnyEnabled } from "../src/frontend/browser-target.js";

test("native-any refuses other targets and resets on the next compile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-native-any-"));
  try {
    const entry = join(dir, "main.ts"); await writeFile(entry, 'const x: number = 1;\n');
    const invalid = await compile(entry, { outDir: dir, outPath: join(dir, "bad.json"), outputKind: "ir", browser: true, dynModel: "native", experimentalTsNativeAny: true });
    expect(invalid.ok).toBe(false);
    expect(invalid.diagnostics.some(d => d.message.includes("requires browser native WasmGC"))).toBe(true);
    const next = await compile(entry, { outDir: dir, outPath: join(dir, "main.json"), outputKind: "ir" });
    expect(next.ok).toBe(true);
    expect(nativeAnyEnabled()).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
