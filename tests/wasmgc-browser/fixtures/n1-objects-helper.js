// Untyped object operations for the native object model (compiled as JavaScript).
export function make(t) { return { tag: t, flags: 0, child: null }; }
export function makeOther(t) { return { flags: 1, tag: t }; }
export function empty() { return {}; }
export function getTag(o) { return o.tag; }
export function getFlags(o) { return o.flags; }
export function get(o, k) { return o[k]; }
export function setFlags(o, v) { o.flags = v; }
export function setKey(o, k, v) { o[k] = v; }
export function del(o, k) { delete o[k]; }
export function delFlags(o) { delete o.flags; }
export function has(o, k) { return k in o; }
export function hasTag(o) { return "tag" in o; }
export function keys(o) { return Object.keys(o); }
export function nest(o, c) { o.child = c; return o.child.tag; }
