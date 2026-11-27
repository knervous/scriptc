import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { compile } from "../../index.js";

const WASM_OPT = join(dirname(fileURLToPath(import.meta.url)), "../../../../../vendor/binaryen-133/binaryen-version_133/wasm-opt.js");

test("an optimized native build keeps each typed array's finalization token (closed-world --gto must not drop the field)", async () => {
  // The token (bytes.track's answer) is written and never read by compiled code; the host frees the storage once it is
  // collected. Dropped, the storage of a live array was freed on the next turn (a streaming client's chunks, 10-25).
  const dir = mkdtempSync(join(tmpdir(), "bytes-token-test-")), out = join(dir, "main.wasm");
  writeFileSync(join(dir, "main.ts"), [
    "const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));",
    "async function sum(bytes: Uint8Array): Promise<number> {",
    "  let total = 0;",
    "  for (let i = 0; i < 4; i++) { const part = bytes.subarray(i * 4, i * 4 + 4); await pause(); total += part[0]! + part[3]!; }",
    "  return total;",
    "}",
    "const data = new Uint8Array(16);",
    "for (let i = 0; i < 16; i++) data[i] = i;",
    "sum(data).then((v) => console.log(v));",
  ].join("\n") + "\n");
  const r = await compile(join(dir, "main.ts"), { outDir: dir, outPath: out, outputKind: "wasmgc", browser: true, dynModel: "native", hostHandles: true, noPageFacades: true, release: true });
  expect(r.ok ? [] : r.diagnostics.map((d) => d.message)).toEqual([]);
  const text = execFileSync(process.execPath, [WASM_OPT, "--all-features", out, "-S", "-o", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  const track = /\(import "host" "bytes\.track" \(func (\$\S+)/.exec(text)?.[1];
  expect(track).toBeDefined();
  expect(text).toContain(`(call ${track}`);
  expect(new RegExp(`\\(drop\\s+\\(call ${track!.replace(/\$/g, "\\$")}\\b`).test(text)).toBe(false);
}, 240000);
