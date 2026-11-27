// Weak references across runtime units, read from a built pack's objects.
//
// A unit may call into an optional unit through a weak declaration and test it for null. An ELF link resolves a weak
// reference the selection does not define to null, but ld64 on arm64 refuses it ("Undefined symbols") whenever the
// referring code is live: scr_json.c's weak scr_record_is_frozen (scr_dyn_native.c) failed every macOS arm64 build that
// reached it. A caller is safe when the definer is a base unit, shares its predicate, or the caller defines a fallback
// itself (a weak definition). Everything else is listed here:
//
// - a base unit (predicate true) with such a reference fails: every program links it;
// - an optional unit's references are the reviewed backlog below, and a new one fails until it is reviewed. Each is
//   safe only while the caller's predicate implies the definer's in every program that reaches the call.
//
// Strong cross-unit references are the COFF class (lld-link reports them even from dead code); there are hundreds,
// and the pack's COFF stand-ins (scr_coff_unlinked.c) cover the ones programs reach.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const packagesDir = fileURLToPath(new URL("../..", import.meta.url));
const runtimeSources = join(packagesDir, "runtime/src");

/** Whether `source` defines a weak fallback for `symbol` in some build (scr_lib.c's scr_insp_dyn_format_s on Mach-O):
 * the object read here may hold only the weak reference, which ELF and wasm links resolve to null. */
function definesWeakFallback(source: string, symbol: string): boolean {
  const path = join(runtimeSources, source);
  if (!existsSync(path)) return false;
  const text = readFileSync(path, "utf8");
  return new RegExp(`__attribute__\\(\\(weak\\)\\)[^;{}]*\\b${symbol}\\s*\\([^;{}]*\\)\\s*\\{`).test(text);
}

/** An LLVM nm: llvm-nm, or the system nm when it is LLVM's (Xcode's is), which reads ELF, Mach-O, COFF and wasm. */
function llvmNm(): string | null {
  for (const candidate of [process.env["LLVM_NM"], "llvm-nm", process.env["LLVM_DIR"] && join(process.env["LLVM_DIR"], "../../../bin/llvm-nm"), "nm"]) {
    if (!candidate) continue;
    try {
      const version = execFileSync(candidate, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      if (/LLVM/.test(version)) return candidate;
    } catch { /* the next candidate */ }
  }
  return null;
}

interface PackUnit { source: string; predicate: unknown; variants: { path: string }[] }

/** The runtime packs built in this checkout (a package's runtime-pack.json exists after its build:native). */
function builtPacks(): { name: string; dir: string; units: PackUnit[]; macho: boolean }[] {
  return readdirSync(packagesDir).filter((n) => n.startsWith("runtime-") && n !== "runtime-pack-common").flatMap((name) => {
    const manifest = join(packagesDir, name, "runtime-pack.json");
    if (!existsSync(manifest)) return [];
    const pack = JSON.parse(readFileSync(manifest, "utf8"));
    const units = pack.flavors?.release?.runtime_units as PackUnit[] | undefined;
    return units ? [{ name, dir: join(packagesDir, name), units, macho: pack.target?.object_format === "macho" }] : [];
  });
}

/** Optional callers' weak references to optional units, reviewed: caller -> symbol. */
const REVIEWED = new Set([
  "scr_dyn_invoke.c -> scr_custom_event_new",
  "scr_dyn_invoke.c -> scr_dyn_native_regex",
  "scr_dyn_invoke.c -> scr_dyn_native_regex_is",
  "scr_dyn_invoke.c -> scr_event_new",
  "scr_dyn_invoke.c -> scr_event_target_new",
  "scr_dyn_invoke.c -> scr_fetch_abort_controller_new",
  "scr_dyn_invoke.c -> scr_regex_new_checked",
  "scr_dyn_invoke.c -> scr_regex_release",
  "scr_dyn_invoke.c -> scr_worker_message_channel",
  "scr_webstreams.c -> scr_stream_duplex_from_web",
  "scr_webstreams.c -> scr_stream_web_pair_hook",
  "scr_stream.c -> scr_sc_blob_value",
  "scr_http.c -> scr_abort_signal_abort",
  "scr_http.c -> scr_abort_signal_controller_new",
  "scr_http.c -> scr_abort_signal_drop_listeners",
  "scr_http.c -> scr_abort_signal_signal",
  "scr_http.c -> scr_events_add_abort_listener",
  "scr_test.c -> scr_dc_chan_has_subscribers",
  "scr_test.c -> scr_dc_channel",
  "scr_test.c -> scr_dc_publish",
  "scr_test.c -> scr_test_abort_controller_abort",
  "scr_test.c -> scr_test_abort_controller_new",
  "scr_test.c -> scr_test_abort_controller_signal",
  "scr_stream_from_web_writable.c -> scr_events_add_abort_listener",
  "scr_stream_duplex_from_web.c -> scr_events_add_abort_listener",
]);

const nm = llvmNm();
const packs = nm === null ? [] : builtPacks();

if (packs.length === 0) test.skip("no built runtime pack (or no llvm-nm) to read unit references from", () => {});

test.each(packs.map((p) => [p.name, p] as const))("%s: no unit holds an unresolvable weak reference into an optional unit", (_name, pack) => {
  const { dir, units, macho } = pack;
  const name = (symbol: string) => (macho && symbol.startsWith("_") ? symbol.slice(1) : symbol);
  const symbols = (args: string[], path: string) =>
    execFileSync(nm!, [...args, "--format=posix", join(dir, path)], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\n").filter(Boolean).map((line) => line.split(" ") as [string, string]);
  const definers = new Map<string, Set<PackUnit>>();
  const references: { unit: PackUnit; symbol: string; ownDefinitions: Set<string> }[] = [];
  for (const unit of units) {
    for (const path of new Set(unit.variants.map((v) => v.path))) {
      const own = new Set<string>();
      for (const [symbol, kind] of symbols(["--defined-only"], path)) {
        if (kind === kind.toLowerCase() && kind !== "w" && kind !== "v") continue; // local symbols
        own.add(name(symbol));
        let set = definers.get(name(symbol));
        if (!set) definers.set(name(symbol), (set = new Set()));
        set.add(unit);
      }
      for (const [symbol, kind] of symbols(["--undefined-only"], path))
        if (kind === "w" || kind === "v") references.push({ unit, symbol: name(symbol), ownDefinitions: own });
    }
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const base: string[] = [], unreviewed: string[] = [];
  for (const { unit, symbol, ownDefinitions } of references) {
    const defs = definers.get(symbol);
    if (!defs || ownDefinitions.has(symbol)) continue; // a system symbol, or the caller's own fallback
    if (!macho && definesWeakFallback(unit.source, symbol)) continue; // the fallback is in the Mach-O build
    if ([...defs].some((d) => d === unit || d.predicate === true || same(d.predicate, unit.predicate))) continue;
    const pair = `${unit.source} -> ${symbol}`;
    if (unit.predicate === true) base.push(`${pair} (defined by ${[...defs].map((d) => d.source).join(", ")})`);
    else if (!REVIEWED.has(pair)) unreviewed.push(pair);
  }
  expect([...new Set(base)].sort(), "base units' weak references into optional units").toEqual([]);
  expect([...new Set(unreviewed)].sort(), "optional units' unreviewed weak references (review, then list them)").toEqual([]);
});
