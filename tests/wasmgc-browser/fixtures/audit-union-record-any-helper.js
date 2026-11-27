export function readPair(r) { return [r.a === undefined ? "u" : typeof r.a === "object" ? "o" : r.a, r.b === undefined ? "u" : r.b].join("|"); }
