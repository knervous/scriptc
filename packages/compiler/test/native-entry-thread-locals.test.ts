import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { compile } from "../src/index.js";

// This fork's threaded native layout compiles each piece of the client with a native entry and links them with a
// thread-instanced runtime (SCR_THREAD_INSTANCES), where the runtime's per-instance state is thread-local. A piece
// must never address that state as a plain global: the address is then one TLS template offset, not the thread's
// own variable (the threaded client's string reads went through scr_str_scan that way).
const THREAD_INSTANCED = [
  "scr_exc_active", "scr_exc_flag", "scr_str_scan", "scr_arena_cur", "scr_cyc_buffers", "scr_cyc_live",
  "scr_cyc_old_freed", "scr_weak_dispose_hook", "scr_yin", "scr_plr_chunk", "scr_thread_hot",
];

const source = `
class Node2 { constructor(public name: string, public next: Node2 | null) {} }
export function scan(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 44 || text[i] === ";") n++;
  return n + text.indexOf("x") + text.split(",").length;
}
export function chain(n: number): number {
  let head: Node2 | null = null;
  for (let i = 0; i < n; i++) head = new Node2("n" + i, head);
  let len = 0;
  for (let p = head; p !== null; p = p.next) len += p.name.length;
  return len;
}
try { console.log(scan("a,b;c,x"), chain(10)); } catch (e) { console.log(String(e)); }
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

test("a native-entry piece addresses no thread-instanced runtime state as a plain global", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-native-entry-tls-"));
  try {
    const entry = join(dir, "main.ts");
    await writeFile(entry, source);
    for (const browser of [false, true]) {
      const outPath = join(dir, `main-${browser}.ll`);
      const result = await compile(entry, {
        outDir: dir, outPath, outputKind: "llvm", optimization: "release",
        ...(browser ? { conditions: ["wasmgc"], browser: true, dynModel: "native" as const, hostHandles: true } : {}),
        nativeEntry: { symbol: "piece_main", runsLoop: false },
      });
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      const ll = await readFile(outPath, "utf8");
      expect(ll).toContain("@piece_main(");
      for (const name of THREAD_INSTANCED) {
        for (const [decl] of ll.matchAll(new RegExp(`^@${name} = external [^\\n]*$`, "gm"))) {
          expect(decl, `${name} (browser ${browser})`).toMatch(/thread_local/);
        }
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
