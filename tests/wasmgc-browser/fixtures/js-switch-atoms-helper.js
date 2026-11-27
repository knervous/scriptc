// String switches over untyped values: keys from for-in and Object.keys,
// literals, typeof results, computed strings, page strings and non-strings.
export function kind(k) {
  switch (k) {
    case "children": return "C";
    case "className": return "N";
    case "data-row": return "row";
    case "onClick": return "click";
    case "style": return "S";
    case "": return "empty";
    case "__proto__": return "proto";
    case "constructor": return "ctor";
    case "0": return "zero";
    case "héllo": return "uni";
    case "children": return "dup";
    default: return "other:" + String(k);
  }
}
export function small(k) { switch (k) { case "a": return 1; case "b": return 2; default: return 0; } }
export function typeName(v) { switch (typeof v) { case "string": return "s"; case "number": return "n"; case "undefined": return "u"; case "function": return "f"; default: return "o"; } }
export function keysOf(o) { const out = []; for (const k in o) out.push(kind(k) + "/" + small(k)); return out.join(","); }
export function objKeys(o) { return Object.keys(o).map(kind).join(","); }
export function literals() { return [kind("children"), kind("data-row"), kind("x"), kind(""), kind("0"), small("a"), small("b"), small("c")].join(","); }
export function computed() { const p = "chil", q = "dren"; return [kind(p + q), kind("data-" + "row"), kind(["on", "Click"].join("")), kind("h" + "éllo"), small("" + "a")].join(","); }
export function nonStrings() { return [kind(0), kind(null), kind(undefined), kind({}), kind(true), small(1), kind(["children"])].join(","); }
export function types() { return [typeName("x"), typeName(1), typeName(undefined), typeName(kind), typeName(null)].join(""); }
