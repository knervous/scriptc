export function makeHandle(label) { const t = new EventTarget(); t.label = label; return t; }
export function labelOf(rec) { return `${rec.name}:${rec.handle ? rec.handle.label : "none"}:${rec.values.size}`; }
