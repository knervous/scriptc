// Method calls a site profile records as reaching one function literal (profiled-method-call fixture).
function readCtx(c) { return (this === dispA || this === dispB ? "r:" : "other-this:") + c + ":" + this.tag + ":" + arguments.length; }
function swapped(c) { return "s:" + c + ":" + this.tag; }
function mk(k) { return function (c) { return k + ":" + c + ":" + arguments.length; }; }
export var dispA = { tag: "A", read: readCtx, cap: mk("x") };
export var dispB = { cap: mk("y"), tag: "B", read: readCtx };
export function call(d, c) { return d.read(c); }
export function callCap(d, c) { return d.cap(c); }
export function callExtra(d) { return d.read(1, 2, 3); }
export function callMissing(d) { return d.read(); }
export function swap(d) { d.read = swapped; }
export function plain(c) { return { tag: "P", read: readCtx }.read(c); }
export function otherRead() { return { tag: "O", read: function (c) { return "o:" + c + ":" + this.tag; } }; }
export function attempt(f) { try { return String(f()); } catch (e) { return e.constructor.name + ": " + e.message; } }
