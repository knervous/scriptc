// The native target's companion selection (bin/native.mjs): node --test npm/wasmgc/test/native.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import {
  buildMachinePlatform,
  missingCompanionMessage,
  missingCompanions,
  parseNativeTarget,
  requiredCompanions,
} from "../bin/native.mjs";

const glibc = { getReport: () => ({ header: { glibcVersionRuntime: "2.39" } }) };
const musl = { getReport: () => ({ header: {} }) };

test("the build machine is one of the four the fork builds on", () => {
  assert.equal(buildMachinePlatform("linux", "x64", glibc), "linux-x64-gnu");
  assert.equal(buildMachinePlatform("linux", "x64", musl), null);
  assert.equal(buildMachinePlatform("win32", "x64"), "win32-x64");
  assert.equal(buildMachinePlatform("darwin", "arm64"), "darwin-arm64");
  assert.equal(buildMachinePlatform("darwin", "x64"), "darwin-x64");
  assert.equal(buildMachinePlatform("android", "arm64"), null);
});

test("native names this machine, native:<platform> any of the five", () => {
  assert.deepEqual(parseNativeTarget("native", "darwin-arm64"), { platform: "darwin-arm64" });
  assert.deepEqual(parseNativeTarget("native:android-arm64", "linux-x64-gnu"), { platform: "android-arm64" });
  assert.match(parseNativeTarget("native:linux-arm64-gnu", "linux-x64-gnu").error, /unknown native platform/);
  assert.match(parseNativeTarget("native", null).error, /no native build/);
});

test("the helper follows the build machine; the runtime and host packs follow the target", () => {
  const names = (needs) => needs.map((n) => n.name);
  assert.deepEqual(names(requiredCompanions("darwin-arm64", "android-arm64")), [
    "@scriptw/llvm-darwin-arm64",
    "@scriptw/runtime-android-arm64",
  ]);
  assert.deepEqual(names(requiredCompanions("linux-x64-gnu", "linux-x64-gnu", { browser: true })), [
    "@scriptw/llvm-linux-x64-gnu",
    "@scriptw/runtime-linux-x64-gnu",
    "@scriptw/host-linux-x64-gnu",
  ]);
  // An embedder's archive or the engine island needs no host pack.
  assert.equal(requiredCompanions("win32-x64", "win32-x64", { browser: true, hostLib: "/x.a" }).length, 2);
  assert.equal(requiredCompanions("win32-x64", "win32-x64", { browser: true, host: "quickjs" }).length, 2);
  // Upstream's names back the helper and the runtime pack; the host pack has none.
  const [llvm, runtime, host] = requiredCompanions("win32-x64", "win32-x64", { browser: true });
  assert.equal(llvm.upstream, "@scriptc/llvm-win32-x64-msvc");
  assert.equal(runtime.upstream, "@scriptc/runtime-win32-x64-msvc");
  assert.equal(host.upstream, null);
});

test("a companion resolves from its directory variable, its @scriptw name, or upstream's", () => {
  const root = mkdtempSync(join(tmpdir(), "scriptw-native-"));
  const from = pathToFileURL(join(root, "app", "index.js"));
  mkdirSync(join(root, "node_modules/@scriptc/runtime-linux-x64-gnu"), { recursive: true });
  writeFileSync(join(root, "node_modules/@scriptc/runtime-linux-x64-gnu/package.json"), "{}");
  const needs = requiredCompanions("linux-x64-gnu", "linux-x64-gnu", { browser: true });
  const missing = missingCompanions(needs, from, { SCRIPTW_HOST_PACK: "/some/pack" });
  assert.deepEqual(missing.map((n) => n.name), ["@scriptw/llvm-linux-x64-gnu"]);
  const message = missingCompanionMessage(missing, "linux-x64-gnu", "linux-x64-gnu");
  assert.match(message, /@scriptw\/llvm-linux-x64-gnu \(the LLVM helper; or set SCRIPTW_LLVM_PACK/);
  assert.match(missingCompanionMessage(missing, "android-arm64", "linux-x64-gnu"), /npm install --force/);
});
