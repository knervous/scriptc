import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, deserializeModule } from "../../index.js";
import { emitWasmGcModule } from "./emitter.js";

// The module comes from the frontend, as every emitted module does: it carries the runtime error classes the
// browser runtime's adopted builtins throw (a hand-built module without them cannot be emitted for the browser).
test("native-any elides only proven unused scalar calls and evaluates arguments", async () => {
  const dir = mkdtempSync(join(tmpdir(), "function-effects-"));
  try {
    writeFileSync(join(dir, "pure.ts"), "let count = 0;\nfunction pure(x: number): number { return x; }\npure(++count);\nconsole.log(count);\n");
    const r = await compile(join(dir, "pure.ts"), { outDir: dir, outPath: join(dir, "m.ir.json"), outputKind: "ir" });
    expect(r.ok, r.ok ? "" : r.diagnostics.map((d) => d.message).join("\n")).toBe(true);
    const mod = deserializeModule(readFileSync(join(dir, "m.ir.json"), "utf8"));
    const normal = emitWasmGcModule(mod, { browser: true, text: true });
    const candidate = emitWasmGcModule(mod, { browser: true, experimentalTsNativeAny: true, text: true });
    expect(candidate.pureCallElisions).toBe(1);
    expect(normal.text).toContain("(call $pure");
    expect(candidate.text).not.toContain("(call $pure");
    expect(candidate.text).toContain("(global.set");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
