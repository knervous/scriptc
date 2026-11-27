// Accessor properties on compiled objects (Object.defineProperty with get/set).
export function accessors(page) {
  const out = [];
  // Receiver, getter/setter, a write-only and a read-only accessor.
  const o = { a: 1 };
  let stored = 0;
  Object.defineProperty(o, "x", { get: function () { return this.a * 10; }, set: function (v) { stored = v; this.a = v; }, enumerable: true, configurable: true });
  Object.defineProperty(o, "ro", { get: function () { return "ro"; } });
  o.x = 4;
  out.push(o.x + "," + stored + "," + o.ro + "," + Object.keys(o).join("+"));
  // Writing a getter-only accessor does nothing (sloppy JS module code is strict: TypeError).
  try { o.ro = 5; out.push("no-throw " + o.ro); } catch (e) { out.push(e instanceof TypeError ? "TypeError" : "other"); }
  // Descriptor flags.
  const d = Object.getOwnPropertyDescriptor(o, "x"), r = Object.getOwnPropertyDescriptor(o, "ro");
  out.push(typeof d.get + typeof d.set + d.enumerable + d.configurable + "|" + typeof r.get + typeof r.set + r.enumerable + r.configurable + ("value" in d));
  // A throwing getter propagates.
  Object.defineProperty(o, "bad", { get: function () { throw new RangeError("nope"); }, configurable: true });
  try { o.bad; out.push("no-throw"); } catch (e) { out.push(e instanceof RangeError ? "RangeError " + e.message : "other"); }
  // Inherited accessor: the getter sees the inheriting object; the setter runs instead of adding an own key.
  const proto = {};
  Object.defineProperty(proto, "v", { get: function () { return this.base + 1; }, set: function (x) { this.base = x * 2; } });
  const child = {};
  Object.setPrototypeOf(child, proto);
  child.base = 1;
  out.push(String(child.v));
  child.v = 5;
  out.push(child.base + "," + Object.keys(child).join("+") + "," + Object.prototype.hasOwnProperty.call(child, "v"));
  // Redefining: accessor -> data, and a non-configurable accessor refuses.
  Object.defineProperty(o, "x", { value: 7, writable: true });
  out.push(String(o.x));
  try { Object.defineProperty(o, "ro", { get: function () { return 0; } }); out.push("redefined"); } catch (e) { out.push(e instanceof TypeError ? "TypeError" : "other"); }
  // React's passive-listener feature test.
  let passive = false;
  try {
    const options = {};
    Object.defineProperty(options, "passive", { get: function () { passive = true; } });
    page.probe(options);
  } catch (e) { passive = "threw"; }
  out.push("passive " + passive);
  // The page sees the accessor through the facade, and can define one.
  out.push(page.describe(o, "ro"));
  const viaPage = {};
  page.defineGetter(viaPage, "g", 42);
  out.push(String(viaPage.g) + "," + Object.keys(viaPage).length);
  return out.join(" | ");
}
// Object-literal accessor syntax.
export function literalAccessors() {
  let hits = 0;
  const o = { base: 2, get double() { hits++; return this.base * 2; }, set double(v) { this.base = v / 2; } };
  o.double = 10;
  const d = Object.getOwnPropertyDescriptor(o, "double");
  return o.double + "," + o.base + "," + hits + "," + typeof d.get + "," + Object.keys(o).join("+");
}
// An untyped caller invoking a typed callback with no arguments (React's
// component-stack probe calls components with no props).
export function callBare(fn) { try { return "ok " + fn(); } catch (e) { return (e instanceof TypeError ? "TypeError" : "other"); } }
// Printing untyped values (the page console formats them).
export function consoleValues(typed, list) {
  const o = { a: 1, b: "two", c: [1, { d: null }], e: undefined };
  console.log(o);
  console.log("mixed", 1, o.c, true);
  const cyc = { name: "self" }; cyc.me = cyc;
  console.log(cyc);
  const bare = { x: 1 }; Object.setPrototypeOf(bare, null);
  console.log(bare);
  const hid = { v: 1 }; Object.defineProperty(hid, "h", { value: 2, enumerable: false });
  console.log(hid, Object.keys(hid).length);
  console.log([undefined, null, "s", 2.5, -0]);
  console.log(typed, list);
}
// A list produced by untyped code (React state hands back what it was given).
export function echo(v) { return v; }
export function makeTodos() { return [{ id: 1, done: true }, { id: 2, done: true }, { id: 3, done: false }]; }
// Page values that are falsy, handed to typed code untouched (React state).
export function falsyValues() { return [false, 0, "", null, undefined, NaN, true, "x", 1, {}]; }
// Page arrays seen by compiled code: Array.isArray, and a typed callback receiving one.
export function pageArrays(pageArr, takeTyped) {
  return Array.isArray(pageArr) + "," + Array.isArray({ length: 1 }) + "," + takeTyped({ tags: pageArr });
}
// JSON.stringify with replacers, indentation and toJSON from compiled JS.
export function jsonForms(typed) {
  const o = { a: 1, b: [1, "x", null], c: { d: true, e: undefined }, when: { toJSON() { return "T"; } } };
  return [
    JSON.stringify(o, (k, v) => (typeof v === "number" && k !== "" ? v * 10 : v)),
    JSON.stringify(o, ["a", "c", "d"]),
    JSON.stringify(o, null, 2),
    JSON.stringify(typed, null, "--"),
    JSON.stringify([1, undefined, () => 1], (k, v) => (k === "zz" ? 0 : v)),
  ].join("\n");
}
