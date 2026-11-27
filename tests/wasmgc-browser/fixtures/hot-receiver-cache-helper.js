// Profiled own-property reads and writes on receivers held in locals, with
// everything between them that may change a receiver's shape or slots: the
// receiver slot caches must never answer from a stale layout.
export function make(n) { return { a: n, b: n + 1, c: n + 2 }; }
// Consecutive reads and an own-slot write: the cached path.
export function sum(o) { return o.a + o.b + o.c; }
export function viaWrite(o) { var s = o.a; o.b = 10; return s + o.b + o.c; }
// A callee reshapes the receiver between reads (grows its slots, rewrites b).
export function viaCall(o, f) { var s = o.a; f(o); return s + o.b + o.c; }
// A getter on another object reshapes it.
export function viaGetter(o, g) { var s = o.a; var t = g.v; return s + t + o.b + o.c; }
// The local is reassigned to an object of another layout.
export function viaAssign(o, p) { var s = o.a; o = p; return s + o.b; }
// A property added through an alias of the receiver.
export function viaAlias(o, q) { var s = o.a; q.y = 5; q.z = 6; q.w = 7; q.v = 8; q.b = 20; return s + o.b + o.c; }
// A delete moves the receiver to a dictionary layout.
export function viaDelete(o) { var s = o.a; delete o.a; return s + "," + o.b + "," + o.a + "," + o.c; }
// A callee reshapes, then throws: the handler and the finally block read again.
export function viaThrow(o, f) { var s = o.a; try { f(o); } catch (e) { return s + o.b + o.c; } return -1; }
export function viaFinally(o, f) { var s = o.a; try { f(o); } finally { s += o.b + o.c; } return s; }
// The same reads around a reshape inside a loop.
export function inLoop(o, f) { var s = 0; for (var i = 0; i < 3; i++) { s += o.a; if (i === 1) f(o); s += o.b * 10; } return s; }
// Reshapers.
export function grow(o) { o.d = 1; o.e = 2; o.f = 3; o.g = 4; o.h = 5; o.b = 99; }
export function accessor(o) { Object.defineProperty(o, "b", { get() { return 77; }, configurable: true }); }
export function growThrow(o) { grow(o); throw new Error("x"); }
export function getterThatGrows(o) { return { get v() { grow(o); return 1000; } }; }
