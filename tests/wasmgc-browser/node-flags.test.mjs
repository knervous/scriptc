import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { wasmNodeArgs } from "./node-flags.mjs";

test("a Node process the runners start with wasmNodeArgs has toResizableBuffer", () => {
  const r = spawnSync(process.execPath, [...wasmNodeArgs, "-p", "typeof WebAssembly.Memory.prototype.toResizableBuffer"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "function");
});
