// Run one compiled fixture in this process (with prelude.mjs imported first)
// the way Node runs the source: stdout from console.log, an uncaught
// exception prints to stderr and exits 1, timers and microtasks settle.
import fs from "node:fs";
import { instantiateWasmGc } from "../../packages/compiler/dist/backend/wasmgc/host.js";

const file = process.argv[2];
let m;
const fail = (e) => {
  const ex = m?.instance.exports;
  let text;
  // A compiled value (a rejection reason that is a GC struct, e.g. a compiled
  // Error) has no JS string conversion: its text comes from the module.
  try { text = String(e?.stack ?? e); } catch { text = ex?.exnText ? String(ex.exnText(e)) : "<compiled value>"; }
  if (e instanceof WebAssembly.Exception && ex?.exn && e.is(ex.exn)) text = ex.exnText(e.getArg(ex.exn, 0));
  process.stderr.write(`Uncaught ${text}\n`);
  process.exit(1);
};
// The harness's typed host module (prelude.mjs) answers as `<scheme>:test-host` under whichever scheme the fixture declares.
const testHostModules = (bytes) => {
  const modules = { ...globalThis.__fixtureHostModules };
  if (bytes.indexOf("scriptc.host-modules") < 0) return modules;
  for (const section of WebAssembly.Module.customSections(new WebAssembly.Module(bytes, { builtins: ["js-string"] }), "scriptc.host-modules")) {
    for (const { module } of JSON.parse(new TextDecoder().decode(section)).modules ?? []) {
      if (module.endsWith(":test-host") && modules[module] === undefined) modules[module] = modules["host:test-host"];
    }
  }
  return modules;
};
try {
  const bytes = fs.readFileSync(file);
  m = await instantiateWasmGc(bytes, { onUncaught: fail, modules: testHostModules(bytes) });
  await m.main();
  // Let microtasks and referenced timers finish, as Node's loop would.
  for (let i = 0; i < 2000 && (i < 2 || m.pendingTimers() > 0); i++) await new Promise((r) => setTimeout(r, 1));
} catch (e) { fail(e); }
