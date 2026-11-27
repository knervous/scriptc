// Sites the profile-specialization test profiles. Each `// site:` marker
// names the text whose span the synthetic profile records.
export function readX(v) { return v.x; } // site: v.x
export function writeX(v, n) { v.x = n; } // site: v.x = n
export function readId(v) { return v.id; } // site: v.id
export function len(v) { return v.length; } // site: v.length
export function callIt(f, a) { return f(a, 2); } // site: f(a, 2)
export function callIt2(f, a) { return f(a, 3); } // site: f(a, 3)
export function plus(p, q) { return p + q + (this === undefined ? 0 : 100); }
export function minus(p, q) { return p - q; }
export function counted() { return arguments.length; }
export function maker(k) { return (p, q) => p * q * k; }
export function Point(x, y) { this.x = x; this.y = y; } // sites: this.x = x, this.y = y (adds)
export function addZ(o, z) { o.z = z; } // site: o.z = z (adds z to {x, y})

/** An {x, y} object whose prototype is `proto`. */
const under = (proto) => { const o = {}; Object.setPrototypeOf(o, proto); o.x = 1; o.y = 2; return o; };
/** Adds: the profiled transitions, then every receiver they must not take. */
export function transitions(tag) {
  const out = [];
  const shown = o => Object.keys(o).map(k => `${k}=${o[k]}`).join(",");
  const p = new Point(1, 2); addZ(p, 3); out.push(shown(p));
  const q = { x: 1, y: 2 }; addZ(q, 4); out.push(shown(q));
  // Other layouts: the key already present, another order, a dictionary, fewer fields.
  const r = { x: 1, y: 2, z: 0 }; addZ(r, 5); out.push(shown(r));
  const s = { y: 1, x: 2 }; addZ(s, 6); out.push(shown(s));
  const d = /** @type {{x: number, y: number, w?: number}} */ ({ x: 1, y: 2, w: 0 }); delete d.w; addZ(d, 7); out.push(shown(d));
  const e = { x: 1 }; addZ(e, 8); out.push(shown(e));
  // An inherited setter for the key takes the write; an inherited data property does not.
  let set = 0; const withSetter = under({ set z(/** @type {number} */ v) { set += v; } });
  addZ(withSetter, 9); out.push(shown(withSetter), set, Object.prototype.hasOwnProperty.call(withSetter, "z"));
  const withData = under({ z: 100 }); addZ(withData, 10); out.push(shown(withData), withData.z);
  // A prototype that passed, then gains a setter: the next add calls it.
  const proto = {}; const a = under(proto); addZ(a, 11); out.push(shown(a));
  let late = 0; Object.defineProperty(proto, "z", { set(/** @type {number} */ v) { late = v; }, configurable: true });
  const b = under(proto); addZ(b, 12); out.push(shown(b), late);
  // A prototype swapped under an object of the profiled layout.
  const c = new Point(5, 6); Object.setPrototypeOf(c, { set z(/** @type {number} */ v) { late = -v; } }); addZ(c, 13); out.push(shown(c), late);
  const n = under(null); addZ(n, 14); out.push(shown(n), n.z);
  // A constructor run on a non-fresh receiver.
  const pre = { y: 0 }; Point.call(pre, 7, 8); out.push(shown(pre));
  for (let i = 0; i < 3; i++) { const t = new Point(i, -i); addZ(t, i * i); out.push(shown(t)); }
  return `${tag}:${out.join(";")}`;
}

export function observations(record) {
  // Adds before any accessor exists, then again after the reads below define some.
  const out = [];
  out.push(transitions("before"));
  // Read: the profiled shape, then every other receiver kind.
  const a = { x: 1, y: 2 };
  out.push(readX(a));
  a.x = 3; out.push(readX(a));
  out.push(readX({ y: 1, x: 4 }), readX({ x: 5 }), readX({ x: 6, y: 7, z: 8 }));
  const viaProto = {}; Object.setPrototypeOf(viaProto, { x: 9 }); out.push(readX(viaProto));
  const hidden = { x: 1, y: 2 }; Object.defineProperty(hidden, "x", { get() { return 10; }, enumerable: true, configurable: true }); out.push(readX(hidden));
  const deleted = /** @type {{x?: number, y: number}} */ ({ x: 1, y: 2 }); delete deleted.x; out.push(String(readX(deleted)));
  let gets = 0; const literalGetter = { get x() { gets++; return 15; }, y: 2 }; out.push(readX(literalGetter), readX(literalGetter), gets);
  const dict = { x: 14, y: 2 }; Object.defineProperty(dict, "y", { value: 3, enumerable: false }); out.push(readX(dict));
  out.push(String(readX([])), String(readX("abc")), String(readX(7)), String(readX(record)));
  try { readX(null); } catch (e) { out.push(e.name); }
  // Write: the profiled shape, another shape, a read-only property.
  const w = { x: 0, y: 0 }; writeX(w, 11); out.push(w.x, readX(w));
  const w2 = { y: 0 }; writeX(w2, 12); out.push(w2.x, Object.keys(w2).join(","));
  const ro = { x: 1, y: 2 }; Object.defineProperty(ro, "x", { value: 1, writable: false });
  try { writeX(ro, 13); out.push("no throw"); } catch (e) { out.push(e.name); }
  // Record arm: a typed record, then a plain object with the same fields (guard miss).
  out.push(readId(record), readId({ id: 21, value: 22 }), String(readId({})));
  out.push(len([1, 2, 3]), len("abcd"), String(len({ length: 5 })));
  // Calls: the profiled literal, another function, `this`, arity, `arguments`, other closures.
  out.push(callIt(plus, 1), callIt(minus, 1), callIt(plus.bind(7), 1), callIt(counted, 1));
  out.push(callIt(maker(3), 2), callIt(maker(4), 2));
  out.push(callIt2(maker(3), 2), callIt2(maker(4), 2), callIt2(plus, 1), callIt2((p, q) => p * q * 1000, 1));
  try { callIt(undefined, 1); } catch (e) { out.push(e.name); }
  out.push(transitions("after"));
  return out.join("|");
}
