// Object literals of one layout {id, value, tag}: literal structs (experimentalJsLiteralStructs).
export function make(i) { return { id: i, value: i % 7, tag: "t" + i }; }
export function odd(i) { return { id: i + 0.5, value: -0, tag: null }; }
export function sum(list) { let s = 0; for (const o of list) s += o.id + o.value; return s; }
export function pick(list, id) { return list.find(o => o.id === id); }
export function setId(o, v) { o.id = v; return o.id; }
export function setValue(o, v) { o.value = v; return o.value; }
export function show(o) { return `${o.id}:${Object.is(o.value, -0) ? "-0" : o.value}:${o.tag}`; }
export function checks(list) {
  const out = [];
  out.push(sum(list), show(pick(list, 17)), pick(list, 99));
  const o = list[3];
  out.push(Object.keys(o).join(","), JSON.stringify(o), "id" in o, o.hasOwnProperty("tag"), Object.getPrototypeOf(o) === Object.prototype, o.constructor === Object);
  const keys = [];
  for (const k in o) keys.push(k);
  out.push(keys.join(","), JSON.stringify({ ...o, extra: 1 }), Object.entries(list[5]).flat().join(","));
  // Values an i32 field cannot hold.
  out.push(setId(list[6], 2 ** 40), setId(list[7], 1.5), setId(list[8], "s"), setValue(list[9], -0), show(list[9]), sum(list.slice(10, 20)));
  out.push(show(odd(4)), JSON.stringify(odd(5)));
  // Shape changes: an expando, a delete, an accessor, freezing.
  const a = list[10], b = list[11], c = list[12], d = list[13];
  a.extra = "x"; delete b.value;
  Object.defineProperty(c, "value", { get() { return 99; }, enumerable: true });
  Object.freeze(d);
  let threw = "no";
  try { setId(d, 5); } catch (e) { threw = e.constructor.name; }
  out.push(JSON.stringify(a), Object.keys(b).join(","), show(c), threw, show(d), Object.isFrozen(d));
  // The other objects of the layout keep working after conversions.
  out.push(sum(list.slice(20)), show(pick(list, 33)), list.filter(x => x.value === 3).length);
  return out.join(" | ");
}
