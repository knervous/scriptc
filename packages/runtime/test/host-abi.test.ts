// The host island ABI (scr_host_island.h) against its append-only history (scr_host_abi.history.json): a change to the
// vtable that does not bump SCR_HOST_ABI, a version that is not an append to the one before, or a layout that differs on
// one of the supported targets fails here, before a host built against another version aborts on first use.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error -- a plain .mjs script, typed by use
import { canonicalHostLayout, parseHostHeader, probeHostLayout } from "../scripts/host-abi-table.mjs";

interface Layout {
  ScrHostVal: { size: number; fields: Record<string, number> };
  ScrHostOps: { size: number };
  constants: Record<string, number>;
}
interface Version {
  abi: number;
  ops: string[];
  runtime: string[];
  layout?: Layout;
}
interface Parsed {
  abi: number;
  ops: string[];
  constants: Record<string, number>;
  runtime: string[];
}

const srcDir = join(import.meta.dirname, "../src");
const history = JSON.parse(readFileSync(join(srcDir, "scr_host_abi.history.json"), "utf8")) as { versions: Version[] };
const latest = history.versions[history.versions.length - 1]!;
const header = parseHostHeader() as Parsed;
const hasClang = spawnSync("clang", ["--version"]).status === 0;

/** The 64-bit layout the history records: abi first, then one 8-byte function pointer per op. */
function expectedOpsOffsets(ops: string[]): Record<string, number> {
  return Object.fromEntries(ops.map((name, i) => [name, i * 8]));
}

describe("host island ABI history", () => {
  test("versions count up by one from 1, each an append to the one before", () => {
    history.versions.forEach((v, i) => {
      expect(v.abi).toBe(i + 1);
      expect(v.ops[0]).toBe("abi");
      if (i === 0) return;
      const prev = history.versions[i - 1]!;
      expect(v.ops.slice(0, prev.ops.length)).toEqual(prev.ops);
      expect(v.ops.length).toBeGreaterThan(prev.ops.length);
      for (const fn of prev.runtime) expect(v.runtime).toContain(fn);
    });
  });

  test("the header is the latest version", () => {
    expect(header.abi).toBe(latest.abi);
    expect(header.ops).toEqual(latest.ops);
    expect(header.runtime).toEqual(latest.runtime);
    expect(header.constants).toEqual(latest.layout!.constants);
  });

  test("the recorded layout is the 64-bit one", () => {
    expect(latest.layout!.ScrHostOps.size).toBe(latest.ops.length * 8);
  });

  test.skipIf(!hasClang)("the C probe prints the recorded layout on this machine", () => {
    const table = probeHostLayout() as {
      abi: number;
      ScrHostOps: { size: number; fields: Record<string, number> };
      ScrHostVal: Layout["ScrHostVal"];
      constants: Record<string, number>;
    };
    expect(table.abi).toBe(latest.abi);
    expect(Object.keys(table.ScrHostOps.fields)).toEqual(latest.ops);
    expect(table.ScrHostOps.fields).toEqual(expectedOpsOffsets(latest.ops));
    expect(table.ScrHostOps.size).toBe(latest.layout!.ScrHostOps.size);
    expect(table.ScrHostVal).toEqual(latest.layout!.ScrHostVal);
    expect(table.constants).toEqual(latest.layout!.constants);
  });

  // The host packs' targets (the design's @scriptw/host-* set): the layout is checked at compile time for each, so a
  // target whose ABI differs (a 32-bit target, a different double alignment) cannot get a host pack by accident.
  const triples = [
    "x86_64-unknown-linux-gnu",
    "x86_64-w64-windows-gnu",
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "aarch64-linux-android26",
  ];
  test.skipIf(!hasClang).each(triples)("the recorded layout holds for %s", (triple) => {
    const layout = latest.layout!;
    const asserts = [
      `_Static_assert(SCR_HOST_ABI == ${latest.abi}, "SCR_HOST_ABI");`,
      `_Static_assert(sizeof(ScrHostOps) == ${layout.ScrHostOps.size}, "sizeof ScrHostOps");`,
      `_Static_assert(sizeof(ScrHostVal) == ${layout.ScrHostVal.size}, "sizeof ScrHostVal");`,
      ...Object.entries(expectedOpsOffsets(latest.ops)).map(
        ([f, off]) => `_Static_assert(offsetof(ScrHostOps, ${f}) == ${off}, "ScrHostOps.${f}");`,
      ),
      ...Object.entries(layout.ScrHostVal.fields).map(
        ([f, off]) => `_Static_assert(offsetof(ScrHostVal, ${f}) == ${off}, "ScrHostVal.${f}");`,
      ),
    ];
    const dir = mkdtempSync(join(tmpdir(), "scr-host-abi-"));
    try {
      const src = join(dir, "layout.c");
      writeFileSync(src, `#include <stddef.h>\n#include "scr_host_island.h"\n${asserts.join("\n")}\n`);
      // Only freestanding headers (stddef, stdint, stdbool): no sysroot needed for any triple.
      execFileSync("clang", ["-target", triple, "-std=c11", "-fsyntax-only", "-ffreestanding", "-I", srcDir, src], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(!hasClang)("the island defines every runtime-side function and asks for scr_host_ops", () => {
    const dir = mkdtempSync(join(tmpdir(), "scr-host-abi-"));
    try {
      const obj = join(dir, "scr_host_island.o");
      execFileSync("clang", ["-std=c11", "-DSCR_DYNAMIC", "-I", srcDir, "-c", join(srcDir, "scr_host_island.c"), "-o", obj], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      const nm = spawnSync("llvm-nm", [obj], { encoding: "utf8" });
      const out = nm.status === 0 ? nm.stdout : execFileSync("nm", [obj], { encoding: "utf8" });
      const defined = new Set(
        out.split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 3 && /[TDB]/.test(p[1]!)).map((p) => p[2]),
      );
      const undefinedSyms = new Set(out.split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p[0] === "U").map((p) => p[1]));
      for (const fn of latest.runtime) expect(defined, fn).toContain(fn);
      expect(undefinedSyms).toContain("scr_host_ops");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The Rust half: the host crate's layout test prints the same table (native/host, abi_layout). It compiles the crate,
  // so it runs only when asked (SCRIPTC_HOST_CRATE_TESTS=1, as the host lane does).
  const hostWorkspace = join(import.meta.dirname, "../../../native/host");
  test.skipIf(!hasClang || process.env["SCRIPTC_HOST_CRATE_TESTS"] !== "1")(
    "the host crate's Rust table is byte-identical to the C table",
    () => {
      const out = execFileSync(
        "cargo",
        ["test", "--release", "-p", "scriptc-host", "--test", "abi_layout", "--", "--nocapture"],
        { cwd: hostWorkspace, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 },
      );
      const rust = out.split("\n").find((line) => line.startsWith('{"abi"'));
      expect(rust).toBe(canonicalHostLayout(probeHostLayout()));
    },
    1_800_000,
  );
});
