// Engine capability probe for Node: exception-handling encodings by validation, and presence of the JS-API entry points.
// usage: node [v8 flags] tests/capabilities/engine-probe.mjs
// Minimal modules: exnref (try_table + throw_ref) and legacy (try/catch) encodings; validate in this engine.
const b = (...x) => new Uint8Array(x.flat());
const hdr = [0,0x61,0x73,0x6d,1,0,0,0];
const types = [1,4,1,0x60,0,0];            // type 0: () -> ()
const funcs = [3,2,1,0];                    // one func of type 0
const tags = [0x0d,3,1,0,0];                // tag section: one tag, type 0
// exnref: block (result exnref) try_table (catch_all_ref 0) end unreachable end throw_ref
const bodyNew = [0x02,0x69, 0x1f,0x40,1,0x03,0, 0x0b, 0x00, 0x0b, 0x0a, 0x0b];
const codeNew = [0x0a, bodyNew.length + 3, 1, bodyNew.length + 1, 0, ...bodyNew];
// legacy: try catch_all end end
const bodyOld = [0x06,0x40, 0x19, 0x0b, 0x0b];
const codeOld = [0x0a, bodyOld.length + 3, 1, bodyOld.length + 1, 0, ...bodyOld];
const v = (code) => { try { return WebAssembly.validate(b(hdr, types, funcs, tags, code)); } catch (e) { return "threw " + e.message; } };
console.log(process.version, JSON.stringify({ exnref: v(codeNew), legacy: v(codeOld), JSTag: typeof WebAssembly.JSTag, Suspending: typeof WebAssembly.Suspending, promising: typeof WebAssembly.promising, toResizableBuffer: typeof WebAssembly.Memory.prototype.toResizableBuffer, waitAsync: typeof Atomics.waitAsync }));
