// Computed keys on a string receiver, through the generic computed read: the
// String.prototype members (and Object.prototype's through it), length,
// canonical indices, and keys that only look like indices. ("constructor" is
// refused natively: js-string-computed-constructor.)
const at = (o, k) => o[k];
export const KEYS = ["toUpperCase", "slice", "charAt", "indexOf", "includes", "at", "trim", "valueOf", "toString",
  "hasOwnProperty", "isPrototypeOf", "length", "0", "2", "3", "-1", "01", "1.0", "missing"];
export function describe(s, v, k) {
  if (typeof v !== "function") return `${typeof v} ${String(v)}`;
  switch (k) {
    case "slice": return `fn ${v.call(s, 1)}`;
    case "charAt": return `fn ${v.call(s, 1)}`;
    case "indexOf": return `fn ${v.call(s, "c")}`;
    case "includes": return `fn ${v.call(s, "b")}`;
    case "at": return `fn ${v.call(s, -1)}`;
    case "hasOwnProperty": return `fn ${v.call(s, "length")} ${v.call(s, "toUpperCase")}`;
    case "isPrototypeOf": return `fn ${v.call(s, s)}`;
    default: return `fn ${v.call(s)}`;
  }
}
export function report() {
  const s = " abc", out = [];
  for (const k of KEYS) out.push(`${k}: ${describe(s, at(s, k), k)}`);
  // Same member, same function, from any string.
  out.push(`identity ${at(s, "toUpperCase") === at("xyz", "toUpperCase")} ${at(s, "slice") !== at(s, "substring")}`);
  // Computed method calls keep the string as `this`.
  const call = (o, k, a, b) => o[k](a, b);
  out.push(`calls ${call(s, "toUpperCase")} ${call(s, "slice", 2)} ${call(s, "padEnd", 6, "!")} ${call(s, "split", "b").join("|")}`);
  try { call(s, "missing"); out.push("no error"); } catch (e) { out.push(`missing call ${e.name}`); }
  return out.join("\n");
}
