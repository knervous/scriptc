// @native-only: profile guards (experimentalJsSpecialize "profile") specialize native dyn reads
// @options: {"experimentalJsSpecialize":"profile","experimentalJsSpecializeProfile":"fixtures/hot-receiver-cache.profile.json"}
// Receiver slot caches under profile guards: consecutive own-slot reads and
// writes on a receiver local reuse one shape test, and nothing that may
// reshape the receiver lets a cache answer from a stale layout: a callee
// growing its slots, a getter on another object, reassigning the local, an
// alias adding properties, a delete, an accessor, an exception caught in the
// same function (handler and finally), and a reshape inside a loop.
// hot-receiver-cache.profile.json: make-fixture-profile.mjs over the helper.
// @hits(native,native-any): ^\$rc\.barrier$
import * as h from "./hot-receiver-cache-helper.js";
const out: string[] = [];
const say = (label: string, v: any) => out.push(label + "=" + String(v));
say("sum", h.sum(h.make(1)));
say("write", h.viaWrite(h.make(1)));
say("call", h.viaCall(h.make(1), h.grow));
say("callAccessor", h.viaCall(h.make(1), h.accessor));
const g = h.make(1);
say("getter", h.viaGetter(g, h.getterThatGrows(g)));
say("assign", h.viaAssign(h.make(1), { b: 5 }));
const al = h.make(1);
say("alias", h.viaAlias(al, al));
say("delete", h.viaDelete(h.make(1)));
say("throw", h.viaThrow(h.make(1), h.growThrow));
try { say("finally", h.viaFinally(h.make(1), h.growThrow)); } catch { say("finally-threw", 1); }
say("finallyOk", h.viaFinally(h.make(1), h.grow));
say("loop", h.inLoop(h.make(1), h.grow));
say("loopAccessor", h.inLoop(h.make(1), h.accessor));
// Warm loops: the same sites over many receivers, some reshaped mid-way.
let acc = 0;
for (let i = 0; i < 200; i++) { const o = h.make(i); acc += h.sum(o); if (i % 50 === 7) h.grow(o); acc += h.viaCall(o, i % 3 ? h.grow : h.accessor); }
say("warm", acc);
console.log(out.join(" "));
