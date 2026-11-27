const name = (f) => { try { return String(f()); } catch (e) { return e.name; } };
export function convert(v) { return [name(() => String(v)), name(() => `${v}`), name(() => v + 1), name(() => v * 2)].join(" "); }
export function plain(v) { return [String(v), v + 1, v * 2, v == "[object Object]"].join(" "); }
export function errors(a, b) { return `${a} ${String(b)}`; }
