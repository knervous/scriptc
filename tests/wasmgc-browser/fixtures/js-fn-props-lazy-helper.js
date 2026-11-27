// Function own properties before and after anything creates the function's
// property object: name/length reads, prototype identity, other keys,
// deletes, redefinitions, enumeration, and functions named by a computed key.
function named(a, b) { return a + b; }
const arrow = (x) => x;
const anon = [function () {}][0];
function Ctor() { this.v = 1; }
function wrap(selector) { return { [selector.name](state) { return selector(state); } }[selector.name]; }
function setName(f, v) { f.name = v; }
function delLength(f) { delete f.length; }
function delName(f) { delete f.name; }
export function run() {
  const out = [];
  out.push(named.name, named.length, arrow.name, arrow.length, typeof anon.name, anon.name === "", anon.length);
  out.push(Object.keys(named).length, "name" in named, named.hasOwnProperty("name"), named.hasOwnProperty("length"));
  // Unknown keys read Function.prototype's members (or undefined).
  out.push(named.displayName, arrow.foo, Object.keys(arrow).length);
  // Fresh closures each time: read name and length, nothing else.
  let total = 0;
  for (let i = 0; i < 50; i++) { const sel = (s) => s + i; total += sel.name.length + sel.length; }
  out.push(total);
  // A wrapper named after its selector (react-redux useSelector's pattern).
  const select = (state) => state.x;
  const wrapped = wrap(select);
  out.push(wrapped({ x: 7 }), select.name);
  // prototype: one object, stable identity, constructor back-link.
  const p1 = Ctor.prototype, p2 = Ctor.prototype;
  out.push(p1 === p2, p1.constructor === Ctor, Object.getPrototypeOf(new Ctor()) === p1, Ctor.name, Ctor.length);
  out.push(arrow.prototype, "prototype" in arrow);
  // Writes and attribute changes after a lazy read.
  const g = function gee(q) { return q; };
  out.push(g.name);
  try { setName(g, "changed"); out.push("no throw"); } catch (e) { out.push(e instanceof TypeError); }
  out.push(g.name);
  out.push(g.length);
  delLength(g);
  out.push(g.length, g.hasOwnProperty("length"));
  const h = function aitch() {};
  h.extra = 1;
  out.push(Object.keys(h).join(","), h.name, h.extra);
  const k = (a, b, c) => a;
  delName(k);
  out.push(k.name === "", k.hasOwnProperty("name"), k.length);
  const zed = function zed(a) {}; out.push(zed.name, zed.length, typeof zed.prototype, zed.prototype.constructor === zed);
  return out.join(" ; ");
}
