// Array.from({ length }, mapper?, receiver?) in untyped JS: ToLength of the
// length, undefined (present) slots, the mapper's this/arguments, bad
// mappers, a too-long length, and the order of the mapper check and ToNumber.
const holes = (a) => { const out = []; for (let i = 0; i < a.length; i++) out.push(i in a ? "v" : "_"); return out.join(""); };
const err = (f) => { try { const a = f(); return "ok " + a.length; } catch (e) { return `${e.name}: ${e.message} ${e instanceof RangeError}`; } };
export function report() {
  const out = [];
  const from = Array.from({ length: 3 });
  out.push(`from ${from.length} ${holes(from)} ${from[1]} ${Array.from({ length: 3 }, (_, i) => i * 2).join(",")} ${Array.from({ length: "2" }).length} ${Array.from({ length: 2.7 }).length} ${Array.from({ length: -1 }).length} ${Array.from({ length: null }).length} ${Array.from({ length: undefined }).length}`);
  const length = 2, calls = [];
  const fromMapped = Array.from({ length }, function (v, i) { calls.push(`${v}:${i}:${arguments.length}:${this.tag}`); return i + this.tag; }, { tag: "t" });
  out.push(`from mapper ${fromMapped.join(",")} ${holes(fromMapped)} ${calls.join(" ")} ${Array.from({ length: { valueOf() { return 2; } } }, () => "v").join("")} ${Array.from({ length: 2 }, undefined).length}`);
  for (const bad of [5, "x", null, {}]) out.push(`from bad mapper ${err(() => Array.from({ length: 1 }, bad))}`);
  out.push(`from too long ${err(() => Array.from({ length: 2 ** 32 }))}`);
  let order = "";
  try { Array.from({ length: { valueOf() { order += "length "; return 1; } } }, (order += "mapper ", 5)); } catch (e) { order += e.name; }
  out.push(`from order ${order}`);
  return out.join("\n");
}
