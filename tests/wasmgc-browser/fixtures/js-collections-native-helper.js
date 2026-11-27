// Map and Set built in an untyped source: compiled collections with the
// page's semantics (SameValueZero keys, insertion order, forEach under
// mutation, construction sources, member reads, conversions), crossing to
// the page as one live collection.
function M(src) { return src === undefined ? new Map() : new Map(src); }
function S(src) { return src === undefined ? new Set() : new Set(src); }
function J(text) { return JSON.parse(text); }
function show(x) { return typeof x === "string" ? JSON.stringify(x) : typeof x === "symbol" ? x.toString() : Array.isArray(x) ? "[" + x.map(show).join(",") + "]" : String(x); }
function entries(m) { const out = []; m.forEach((v, k) => { out.push(show(k) + "=" + show(v)); }); return out.join(" "); }
function caught(f) { try { return "ok " + show(f()); } catch (e) { return e.name + ": " + e.message; } }
export function basics() {
  const out = [];
  const m = M();
  out.push(m.size, m.get("a"), m.has("a"), m.delete("a"));
  out.push(m.set("a", 1) === m, m.set("b", 2).set("c", 3).size, m.get("b"), m.has("c"), m.get("zz"));
  m.set("a", 10); out.push(entries(m));
  out.push(m.delete("a"), m.delete("a"), m.size, entries(m));
  m.set("a", 11); out.push(entries(m));
  m.clear(); out.push(m.size, entries(m), m.get("b"));
  const s = S();
  out.push(s.add(1) === s, s.add(2).add(1).size, s.has(1), s.has(3), s.delete(2), s.delete(2), s.size);
  s.add("x"); s.add(1); const seen = []; s.forEach((v, k, set) => { seen.push(show(v) + "/" + show(k) + "/" + (set === s)); }); out.push(seen.join(" "));
  s.clear(); out.push(s.size);
  out.push(m.get(), m.has(), m.set().size, m.has(undefined), m.get(undefined));
  return out.map(show).join(" ");
}
export function keys(pageObj) {
  const out = [];
  const m = M(), o = {}, a = [1], f = function () {}, reg = Symbol.for("app.k");
  m.set(NaN, "nan").set(-0, "zero").set("1", "str1").set(1, "num1").set(true, "t").set(null, "null").set(undefined, "undef");
  m.set(o, "obj").set(a, "arr").set(f, "fn").set(reg, "reg").set(pageObj, "page");
  out.push(m.get(NaN), m.get(0 / 0), m.get(0), m.get(+0), m.get(-0), m.get("1"), m.get(1), m.get(true), m.get(1 === 1), m.get(null), m.get(undefined));
  out.push(m.get(o), m.get({}), m.get(a), m.get([1]), m.get(f), m.get(reg), m.get(Symbol.for("app.k")), m.get(Symbol.for("app.j")), m.get(pageObj), m.get("true"), m.get(false));
  const ks = []; m.forEach((v, k) => { ks.push(k === 0 ? (1 / k > 0 ? "+0" : "-0") : typeof k); }); out.push(ks.join(","));
  out.push(m.size, m.delete(-0), m.has(0), m.delete(NaN), m.has(NaN), m.size);
  const s = S(J("[0,\"0\",1]")); s.add(NaN); s.add(NaN); s.add(-0); s.add(o); s.add(o); s.add(a);
  out.push(s.size, s.has(NaN), s.has(-0), s.has("0"), s.has(o), s.has([1]));
  const big = M();
  for (let i = 0; i < 1000; i++) big.set(i % 3 ? "k" + i : i, i);
  for (let i = 0; i < 1000; i += 2) big.delete(i % 3 ? "k" + i : i);
  for (let i = 0; i < 50; i++) big.set("n" + i, -i);
  let sum = 0; const firsts = []; big.forEach((v, k) => { sum += v; if (firsts.length < 4) firsts.push(show(k)); });
  out.push(big.size, sum, firsts.join(","), big.get("k999"), big.get(998), big.get("n49"));
  return out.map(show).join(" ");
}
export function forEachRules() {
  const out = [];
  const m = M(J('[["a",1],["b",2],["c",3]]'));
  const log = [];
  m.forEach(function (v, k, map) { log.push(k + v + (map === m) + (this === undefined ? "u" : this.tag)); if (k === "a") { m.delete("b"); m.set("d", 4); m.set("a", 9); } }, { tag: "T" });
  out.push(log.join(" "), entries(m));
  const log2 = []; m.forEach((v, k) => { log2.push(k); if (k === "a") { m.clear(); m.set("z", 0); } }); out.push(log2.join(""), entries(m));
  const log3 = []; let thrown = "";
  const n = M(J('[["x",1],["y",2]]'));
  try { n.forEach((v, k) => { log3.push(k); throw new Error("stop " + k); }); } catch (e) { thrown = e.message; }
  for (let i = 0; i < 40; i++) { n.set("t" + i, i); n.delete("t" + (i - 1)); }
  out.push(log3.join(""), thrown, n.size, entries(n));
  const bads = J('[null, 5, "x", {}]'), msgs = [caught(() => m.forEach())];
  for (let i = 0; i < bads.length; i++) msgs.push(caught(() => m.forEach(bads[i])));
  out.push(msgs.join(" | "));
  const s = S(J("[1,2,3]")); const log4 = [];
  s.forEach((v) => { log4.push(v); if (v === 1) { s.delete(2); s.add(4); } }); out.push(log4.join(""));
  return out.map(show).join(" ");
}
export function construction(page) {
  const out = [];
  const src = M(J('[["k1","v1"],["k2","v2"],["k1","v3"]]'));
  out.push(entries(src), entries(M(src)), entries(M(null)), entries(M(undefined)), S(src).size);
  out.push(entries(S("abca")), entries(S(S(J("[3,2,3]")))), entries(M(J("[[1,2],[3]]"))), entries(M(J("[[1,2,3]]"))));
  out.push(entries(M(S(J('[["s",1]]')))), entries(M(J('[["p",1],["q",2]]').map((e) => [e[0] + "!", e[1]]))), entries(S(page.auditFloats())), entries(S([page.auditMake(), 1])));
  const bads = J('[[1], [[1,2],3], 5, {}, ["ab"]]'), msgs = [];
  for (let i = 0; i < bads.length; i++) msgs.push(caught(() => M(bads[i]).size));
  msgs.push(caught(() => S(5)));
  out.push(msgs.join(" | "));
  const copy = M(src); copy.set("k3", 3); out.push(src.size, copy.size);
  return out.map(show).join(" ");
}
export function members() {
  const out = [];
  const m = M(J('[["a",1]]')), s = S(J("[1]"));
  const MP = Object.getPrototypeOf(m), SP = Object.getPrototypeOf(s);
  out.push(m.get === MP.get, typeof m.forEach, typeof m.keys, m.foo, s.foo, typeof s.add, s.add === SP.add, typeof s.union, m.constructor === MP.constructor, typeof s.constructor, m.constructor === s.constructor);
  out.push("get" in m, "size" in m, "add" in m, "add" in s, "get" in s, "foo" in m, "toString" in m, "hasOwnProperty" in s);
  out.push(typeof m, String(m), "" + s, `${m}`, Object.prototype.toString.call(m), Object.prototype.toString.call(s), m.hasOwnProperty("size"), Object.keys(m).length);
  out.push(MP === Object.getPrototypeOf(M()), SP === Object.getPrototypeOf(S()), MP === SP, JSON.stringify(m), JSON.stringify({ m }));
  // (The engine lane's page reports these with its own wording: names only.)
  out.push(...[() => m.add(1), () => s.get(1), () => m.size(), () => m.nope()].map((f) => caught(f).split(":")[0]));
  const plus = (x, y) => x + y, loose = (x, y) => x == y, num = (x) => x * 1;
  out.push(loose(m, "[object Map]"), plus(m, 1), isNaN(num(m)));
  return out.map(show).join(" ");
}
export function crossing(page) {
  const out = [];
  const m = M(J('[["a",1],["b",2]]')), s = S(J('["x"]'));
  out.push([...m].map((e) => e.join(":")).join(","), [...m.keys()].join(","), Array.from(m.values()).join(","), [...s].join(","));
  // After crossing, compiled operations and the page's view are one collection.
  m.set("c", 3); m.delete("a");
  out.push(m.size, m.get("c"), m.has("a"), entries(m), page.auditIdentity(m) === m, page.auditIdentity(s) === s);
  const fresh = M(J('[["q",1]]'));
  out.push(page.auditIdentity(fresh) === fresh, page.auditCallWith(function () { return this.get("q") + this.size; }, fresh), fresh.size);
  page.auditKeep(fresh); fresh.set("r", 2); out.push(page.auditKept().size, page.auditKept() === fresh, page.auditKept().get("r"));
  const holder = { inner: S(J("[1,2]")) };
  page.auditKeep(holder); out.push(page.auditKept().inner.size, page.auditKept().inner.has(2));
  holder.inner.add(3); out.push(holder.inner.size, page.auditKept().inner.size);
  const u = S(J("[1,2]")); out.push([...u.union(S(J("[3]")))].join(","), u.size);
  return out.map(show).join(" ");
}
export function ownProperties(page) {
  const out = [];
  const m = M(J('[["a",1]]')), s = S(J("[1]"));
  out.push(m.hasOwnProperty("extra"), Object.keys(m).length, "extra" in m);
  m.extra = 7; s.tag = "t";
  out.push(m.extra, s.tag, "extra" in m, m.hasOwnProperty("extra"), Object.keys(m).join(","), m.get("a"), m.size);
  let n = 0; for (const k in m) n++; out.push(n);
  delete m.extra; out.push(m.extra, "extra" in m, Object.keys(m).length, m.size);
  page.auditMutate(m); out.push(m.n, m.get("n"));
  return out.map(show).join(" ");
}
