// Prop-bag iteration over untyped objects: `for (k in o)` with the presence
// recheck, `o.hasOwnProperty(k)`, `hasOwnProperty.call(o, k)` and `o[k]`.
var hasOwnProperty = Object.prototype.hasOwnProperty;
export function copy(config) { var props = {}, k; for (k in config) hasOwnProperty.call(config, k) && "key" !== k && (props[k] = config[k]); return props; }
export function walk(props) { var out = [], k; for (k in props) if (props.hasOwnProperty(k)) { var v = props[k]; if (v != null) out.push(k + "=" + String(v)); } return out.join(","); }
export function plain(o) { var out = [], k; for (k in o) out.push(k + ":" + String(o[k])); return out.join(","); }
// The walked object changes during the walk: a later key deleted (the recheck
// skips it), keys added (not visited), a later value replaced, the object
// variable or the key variable reassigned.
export function deleting(o) { var out = [], k; for (k in o) { out.push(k + "=" + o[k]); if (k === "a") delete o.c; } return out.join(","); }
export function adding(o) { var out = [], k; for (k in o) { out.push(k + "=" + o[k]); o["n" + k] = 1; } return out.join(",") + "|" + Object.keys(o).join(","); }
export function replacing(o) { var out = [], k; for (k in o) { out.push(k + "=" + o[k]); if (k === "a") o.b = "B"; } return out.join(","); }
export function reassignObj(o, p) { var out = [], k; for (k in o) { out.push(k + "=" + o[k]); o = p; } return out.join(","); }
export function reassignKey(o) { var out = [], k; for (k in o) { k = "z"; out.push(String(o[k])); } return out.join(","); }
export function nested(o, p) { var out = [], k, j; for (k in o) for (j in p) out.push(k + j + "=" + o[k] + p[j] + (o.hasOwnProperty(k) ? "o" : "-") + (hasOwnProperty.call(p, j) ? "p" : "-")); return out.join(","); }
export function ownHop(o) { var out = [], k; for (k in o) out.push(k + ":" + String(o.hasOwnProperty(k))); return out.join(","); }
export function otherCall(o) { var hop = function (key) { return key === "a"; }, out = [], k; for (k in o) out.push(k + ":" + String(hop.call(o, k))); return out.join(","); }
export function getters() { var hits = 0, o = { a: 1 }; Object.defineProperty(o, "g", { get: function () { hits++; return "G" + hits; }, enumerable: true, configurable: true }); o.b = 2; var s = walk(o) + "|" + plain(o); return s + "|" + hits; }
export function bare() { var o = { __proto__: null, a: 1, b: 2 }; var out = [], k; for (k in o) out.push(k + "=" + o[k]); try { for (k in o) o.hasOwnProperty(k); } catch (e) { out.push(e.name); } return out.join(","); }
function P() { this.a = 2; }
P.prototype.p = 1;
export function inherited() { var o = new P(); var out = [], k; for (k in o) out.push(k + ":" + o[k] + ":" + o.hasOwnProperty(k) + ":" + hasOwnProperty.call(o, k)); return out.join(","); }
export function all(page) {
  return [walk(copy({ a: 1, key: 2, b: null, c: "x", d: undefined, e: 0 })),
    plain({ x: 1, y: [1, 2], z: "s" }), plain(page), walk(page),
    deleting({ a: 1, b: 2, c: 3, d: 4 }), adding({ a: 1, b: 2 }), replacing({ a: 1, b: 2, c: 3 }),
    reassignObj({ a: 1, b: 2 }, { a: "A", b: "B" }), reassignKey({ a: 1, z: "Z" }), nested({ a: 1, b: 2 }, { c: 3 }),
    ownHop({ a: 1, hasOwnProperty: function () { return false; } }), ownHop({ a: 1, b: 2 }), otherCall({ a: 1, b: 2 }),
    getters(), bare(), inherited()].join("\n");
}
