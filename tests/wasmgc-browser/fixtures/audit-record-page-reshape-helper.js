export function inspect(d) { return [d.n, Object.keys(d).join(), "n" in d, Object.prototype.hasOwnProperty.call(d, "a"), JSON.stringify(d), d.a, d.z].join(" "); }
export function write(d, k, v) { d[k] = v; }
