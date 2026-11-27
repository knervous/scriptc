#!/usr/bin/env node
// The host island ABI as one JSON table: SCR_HOST_ABI, each ScrHostOps field in header order with its offset, the
// ScrHostVal layout and the SCR_HV_* / SCR_HOST_* constants. The table comes from two sources, and both must agree:
// the header's text (field order, version) and a C probe compiled against the header for the target (offsets, sizes,
// constant values). A host implementation's own layout test prints the same table, and the two are compared byte for
// byte.
//
//   node packages/runtime/scripts/host-abi-table.mjs [--cc=<clang>] [--canonical]
//
// The probe compiles and runs only when the target is the machine's own; with --target it is compiled only, and the
// offsets come from the history file's 64-bit layout check instead (see host-abi.test.ts).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
export const headerPath = join(srcDir, "scr_host_island.h");

/** The header's own view of the ABI: SCR_HOST_ABI, the ScrHostOps field names in order, the SCR_HV_* / SCR_HOST_*
 * constants, and the runtime-provided scr_host_* functions it declares. */
export function parseHostHeader(text = readFileSync(headerPath, "utf8")) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const abi = Number(/#define\s+SCR_HOST_ABI\s+(\d+)/.exec(code)?.[1]);
  const opsBody = /typedef\s+struct\s+ScrHostOps\s*\{([\s\S]*?)\}\s*ScrHostOps\s*;/.exec(code)?.[1];
  if (!Number.isInteger(abi) || opsBody === undefined) throw new Error("scr_host_island.h: no SCR_HOST_ABI or ScrHostOps");
  const ops = [];
  for (const decl of opsBody.split(";")) {
    const d = decl.trim();
    if (d === "") continue;
    const fn = /\(\s*\*\s*(\w+)\s*\)/.exec(d);
    const plain = /(\w+)\s*$/.exec(d);
    const name = fn?.[1] ?? plain?.[1];
    if (name === undefined) throw new Error(`scr_host_island.h: unreadable ScrHostOps member: ${d}`);
    ops.push(name);
  }
  const constants = {};
  for (const m of code.matchAll(/\b(SCR_(?:HV|HOST)_[A-Z]+)\s*=\s*(\d+)/g)) constants[m[1]] = Number(m[2]);
  const runtime = [...code.matchAll(/^[\w\s*]*?\b(scr_host_\w+)\s*\(/gm)].map((m) => m[1]).filter((n) => n !== "scr_host_ops");
  return { abi, ops, constants, runtime };
}

/** The C probe's source: prints the layout table as JSON. */
export function probeSource(ops, constants) {
  const lines = [
    '#include <stddef.h>',
    '#include <stdio.h>',
    '#include "scr_host_island.h"',
    "int main(void) {",
    '  printf("{\\"abi\\":%d,", SCR_HOST_ABI);',
    '  printf("\\"ScrHostOps\\":{\\"size\\":%zu,\\"fields\\":{", sizeof(ScrHostOps));',
    ...ops.map((f, i) => `  printf("${i ? "," : ""}\\"${f}\\":%zu", offsetof(ScrHostOps, ${f}));`),
    '  printf("}},");',
    '  printf("\\"ScrHostVal\\":{\\"size\\":%zu,\\"fields\\":{", sizeof(ScrHostVal));',
    ...["kind", "flag", "number", "str", "len", "ref"].map(
      (f, i) => `  printf("${i ? "," : ""}\\"${f}\\":%zu", offsetof(ScrHostVal, ${f}));`,
    ),
    '  printf("}},\\"constants\\":{");',
    ...Object.keys(constants).map((c, i) => `  printf("${i ? "," : ""}\\"${c}\\":%d", (int)${c});`),
    '  printf("}}\\n");',
    "  return 0;",
    "}",
  ];
  return lines.join("\n") + "\n";
}

/** Compiles and runs the probe with `cc` for this machine; returns the parsed table. */
export function probeHostLayout({ cc = process.env.CC ?? "clang" } = {}) {
  const parsed = parseHostHeader();
  const dir = mkdtempSync(join(tmpdir(), "scr-host-abi-"));
  try {
    const src = join(dir, "probe.c");
    const exe = join(dir, process.platform === "win32" ? "probe.exe" : "probe");
    writeFileSync(src, probeSource(parsed.ops, parsed.constants));
    execFileSync(cc, ["-std=c11", "-Wall", "-Werror", "-I", srcDir, src, "-o", exe], { stdio: ["ignore", "ignore", "pipe"] });
    return JSON.parse(execFileSync(exe, { encoding: "utf8" }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The table in the one-line canonical form the host crate's layout test prints (native/host,
 * `cargo test -p scriptc-host --test abi_layout -- --nocapture`): fields as ordered `{name, offset}` lists, ScrHostVal
 * before ScrHostOps, the constants in the header's order. The two strings must be byte-identical. */
export function canonicalHostLayout(table) {
  const fields = (f) => Object.entries(f).map(([name, offset]) => ({ name, offset }));
  return JSON.stringify({
    abi: table.abi,
    ScrHostVal: { size: table.ScrHostVal.size, fields: fields(table.ScrHostVal.fields) },
    ScrHostOps: { size: table.ScrHostOps.size, fields: fields(table.ScrHostOps.fields) },
    constants: table.constants,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cc = process.argv.find((a) => a.startsWith("--cc="))?.slice(5);
  const table = probeHostLayout(cc ? { cc } : {});
  process.stdout.write(
    (process.argv.includes("--canonical") ? canonicalHostLayout(table) : JSON.stringify(table, null, 2)) + "\n",
  );
}
