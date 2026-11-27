export function read(e) { return e.v; }
export function write(e, x) { e.v = x; return e.v; }
export function keys(e) { return Object.keys(e).join(); }
export function has(e) { return "v" in e; }
export function desc(e) { const d = Object.getOwnPropertyDescriptor(e, "v"); return typeof d.get + "/" + typeof d.set; }
export function sum(e) { return e.v + e.w; }
