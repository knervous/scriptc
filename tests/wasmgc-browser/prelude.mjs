// Host-side fixtures shared by the JS oracle and the compiled run: each
// fixture talks to "the page" only through these globals.
let kept;
let closed = 0;
const listeners = new Set();
Object.assign(globalThis, {
  auditDeleteKey: (o, key) => { delete o[key]; },
  auditKeep: (v) => { kept = v; },
  auditKept: () => kept,
  auditCompare: (v) => console.log("same", v === kept),
  auditMutate: (v) => { v.n = 9; },
  auditUndefined: (v) => console.log("undefined", v === undefined),
  auditReturn: (f) => console.log("return", f() === undefined),
  auditHostJob: () => queueMicrotask(() => console.log("b")),
  auditReentry: (outer, inner) => console.log("outer", outer.call({ n: 1 }, () => inner.call({ n: 2 }))),
  auditAdd: (f) => { listeners.add(f); },
  auditRemove: (f) => { listeners.delete(f); },
  auditFire: () => { for (const f of listeners) f(); },
  auditCount: () => listeners.size,
  auditIdentity: (v) => v,
  auditCallWith: (f, self, ...args) => f.apply(self, args),
  auditKeys: (v) => Object.keys(v).join(","),
  auditMake: () => (globalThis.__made = { n: 1 }),
  auditMadeN: () => globalThis.__made.n,
  auditPush: (a) => { a.push(3); },
  auditWrite: (a) => { a[1] = 9; },
  auditRead: () => kept[2],
  auditFloats: () => new Float32Array([0.5, 1.5]),
  // A GPU-shaped queue/encoder: submit consumes a WebIDL sequence, so it
  // reports whether it received a real Array and each element's label.
  auditGpu: () => {
    let n = 0;
    const encoder = { finish: () => ({ label: "cb" + n++ }) };
    const queue = { submit: (cbs) => console.log("submit", Array.isArray(cbs), cbs.length, Array.from(cbs, (c) => c.label).join(",")) };
    return { encoder, queue };
  },
  // Second-round audit probes.
  auditBytesInfo: (v) => console.log(v.byteOffset, v.buffer.byteLength),
  auditEnqueue: (cb) => queueMicrotask(cb),
  auditMakeAccessor: () => { let hits = 0; globalThis.__hits = () => hits; return { get n() { hits++; return 1; } }; },
  auditAccessorHits: () => globalThis.__hits(),
  auditMakeArray: () => (globalThis.__arr = [1, 2]),
  auditArrayN: () => globalThis.__arr[0],
  auditArrayIs: (v) => v === globalThis.__arr,
  auditDelete: (v) => { console.log("delete", delete v.n, "n" in v, v.n); },
  auditDeleteArray: (v) => { console.log("delete", delete v[0], 0 in v, v[0]); },
  auditFreeze: (v) => { try { Object.freeze(v); console.log("frozen", Object.isFrozen(v)); } catch (e) { console.log("freeze error"); } },
  auditHoles: (v) => console.log("holes", 2 in v, Object.keys(v).join(","), v[2]),
  // A JS number carrying the compiler's reserved undefined bit pattern.
  auditNaNBits: () => { const b = new DataView(new ArrayBuffer(8)); b.setUint32(0, 1, true); b.setUint32(4, 0x7ff40000, true); return b.getFloat64(0, true); },
  auditIs2: (x, y) => x === y,
  auditMake2: () => (globalThis.__made2 = { n: 1, label: "x" }),
  auditTouch: (o) => { o.n *= 10; },
  auditIs: (o) => o === globalThis.__made2,
  // Third-round audit probes.
  auditSymbol: () => Symbol.for("audit"),
  auditBigInt: () => 1n,
  auditFn: () => function () {},
  auditInspect: (v) => console.log(v.n, Array.isArray(v.a), v.a?.length),
  auditView: () => new Uint8Array([1, 2]),
  // N4 page-facade probe: everything a page does with a plain object/array.
  auditFacade: (o) => {
    const out = [];
    out.push(o.n, o.inner === o.inner, Array.isArray(o.list), o.list.length, o.list.map((x) => x * 2).join("+"));
    o.list.push(4); o.n = 9; o.added = "p"; delete o.gone;
    out.push(Object.keys(o).join(","), JSON.stringify(o.inner), "gone" in o, o.greet(), String(Object.keys(o.sparse)));
    globalThis.__kept = o;
    return out.join(" ");
  },
  auditFacadeKept: () => globalThis.__kept,
  // Accessor probes: React's passive test reads options.passive; descriptors and definitions from the page.
  auditAccessorPage: () => ({
    probe: (o) => { void o.passive; },
    describe: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return typeof d.get + "," + d.set + "," + d.enumerable + "," + d.configurable + "," + d.get.call(o); },
    defineGetter: (o, k, v) => { Object.defineProperty(o, k, { get: () => v, enumerable: false, configurable: true }); },
  }),
  // Fourth-round audit probes (boundary contract).
  auditHidden: o => { const d = Object.getOwnPropertyDescriptor(o, 'h'); return Object.getOwnPropertyNames(o).join(',') + '|' + Object.keys(o).join(',') + '|' + d.enumerable + ',' + d.configurable; },
  auditDefine: o => { const ok = Reflect.defineProperty(o, 'h', { value: 2, writable: false, enumerable: false, configurable: true }); const d = Object.getOwnPropertyDescriptor(o, 'h'); const set = Reflect.set(o, 'h', 3); return [ok, d.value, d.writable, d.enumerable, d.configurable, set, o.h, Object.keys(o).join(',')].join('|'); },
  auditBare: o => (Object.getPrototypeOf(o) === null) + '|' + ('toString' in o) + '|' + typeof o.toString,
  auditProxy: f => new Proxy(f, { apply() { return 99; } }),
  auditCopy: f => Object.assign(function () { return 99; }, f),
  auditFunctionKeys: f => Object.getOwnPropertySymbols(f).length,
  auditExtensible: o => { const ok = Reflect.preventExtensions(o); let keys; try { keys = Object.keys(o).join(','); } catch (e) { keys = 'throw:' + e.name; } return ok + '|' + Object.isExtensible(o) + '|' + keys; },
  auditReceiver: o => { const r = {}; const ok = Reflect.set(o, 'x', 9, r); return ok + '|' + o.x + '|' + r.x; },
  auditIterator: () => ({ [Symbol.iterator]() { return { next() { return { value: 42, done: false }; }, return() { closed++; return { done: true }; } }; } }),
  auditClosed: () => closed,
});

// Custom host iterable for dynamic call-spread differential coverage.
globalThis.auditSpreadIterable = order => ({ [Symbol.iterator]() { let i = 0; return { next() { order.push(`next${i}`); return i++ === 0 ? {value:8,done:false} : {value:undefined,done:true}; } }; } });

globalThis.auditOwnSymbols = object => Object.getOwnPropertySymbols(object);
// An object's own enumerable entries in order, as the page sees them.
globalThis.auditEntries = (o) => Object.entries(o).map(([k, v]) => `${k}=${String(v)}`).join(",");
// A BufferSource read/write as GPUQueue.writeBuffer consumes one: a view's
// elements from `offset`, or an ArrayBuffer's bytes from `offset`.
globalThis.auditReadSource = (source, offset, size) => Array.from(ArrayBuffer.isView(source)
  ? new Uint8Array(source.buffer, source.byteOffset + offset, size) : new Uint8Array(source, offset, size)).join(",");
globalThis.auditWriteSource = (source, offset, value) => {
  (ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source))[offset] = value;
};

// Facade traps across several live facades at once (one shared handler per
// kind must still address each facade's own compiled value and Proxy).
globalThis.auditFacadeTraps = (a, b, c, d) => {
  const out = [], sym = Symbol.for("facade-traps");
  const keys = o => Object.keys(o).join(",");
  const desc = (o, k) => { const x = Object.getOwnPropertyDescriptor(o, k); return x ? [x.value, x.writable, x.enumerable, x.configurable].join("/") : "none"; };
  out.push(a.x, b.x, "x" in a, "y" in a, "y" in b, keys(a), keys(b));
  a.x = 5;
  out.push(a.x, b.x);
  // Foreign receivers: another facade, an inheriting object, a plain object.
  out.push(Reflect.set(a, "x", 7, b), a.x, b.x, desc(b, "x"));
  out.push(Reflect.set(a, "y", 1, a), a.y, "y" in b);
  const child = Object.create(a); child.z = 3;
  out.push(child.z, "z" in a, Object.hasOwn(child, "z"), child.x, keys(child));
  const plain = {}; out.push(Reflect.set(b, "x", 11, plain), plain.x, b.x);
  // Symbols live on each facade's own target.
  a[sym] = "s"; out.push(a[sym], b[sym], sym in a, sym in b, Object.getOwnPropertySymbols(a).length, Object.getOwnPropertySymbols(b).length);
  // Attributes, mirrored non-configurable slots, accessors and deletes.
  Object.defineProperty(a, "h", { value: 1, writable: false, enumerable: false, configurable: false });
  out.push(desc(a, "h"), desc(b, "h"), keys(a), Reflect.set(a, "h", 2), a.h, Reflect.deleteProperty(a, "h"));
  Object.defineProperty(b, "g", { get() { return this.x * 2; }, enumerable: true, configurable: true });
  out.push(b.g, "g" in a, typeof Object.getOwnPropertyDescriptor(b, "g").get, keys(b));
  out.push(delete b.x, "x" in b, b.x, a.x, keys(b));
  out.push(Object.getPrototypeOf(a) === Object.prototype, Object.getPrototypeOf(c) === Array.prototype, Object.isExtensible(a), Object.isExtensible(c));
  // Arrays: lengths, inherited methods through the receiver, holes, descriptors.
  out.push(Array.isArray(c), Array.isArray(d), c.length, d.length);
  c.push(4); d.push(8, 9); c[6] = 6;
  out.push(c.length, d.length, keys(c), keys(d), 5 in c, desc(c, "length"), desc(d, "1"), c.join("-"), d.map(v => v + 1).join("-"));
  out.push(Reflect.set(c, "0", 10, d), c[0], d[0]);
  out.push(JSON.stringify(a), JSON.stringify(b), JSON.stringify(c), JSON.stringify(d));
  globalThis.__facadeTraps = [a, b, c, d];
  return out.join(" ");
};
globalThis.auditFacadeTrapsKept = () => globalThis.__facadeTraps;

// A constructor-built object seen by the page: reads, `in`, enumeration and
// JSON through its facade, a write of an existing property, then a new key.
globalThis.auditCtorObject = (v) => {
  const out = [Object.keys(v).join(","), JSON.stringify(v), v.tag, v.flags, "child" in v, "nope" in v, typeof v.describe, v.describe()];
  v.flags = 7;
  out.push(v.flags, Object.getOwnPropertyDescriptor(v, "flags").writable);
  v.pageExtra = "p";
  out.push(Object.keys(v).join(","));
  return out.join(" ");
};

// Record facades of one shape, live at once: each addresses its own struct
// and adoption (a delete or freeze reshapes only that record).
globalThis.auditRecordPair = (r1, r2, t1, t2) => {
  const out = [], keys = o => Object.keys(o).join(",");
  const desc = (o, k) => { const x = Object.getOwnPropertyDescriptor(o, k); return x ? [x.value, x.writable, x.enumerable, x.configurable].join("/") : "none"; };
  out.push(r1.n, r2.n, r1.label, r2.label, keys(r1), keys(r2), "n" in r1, "zz" in r2);
  r1.n = 10; r1[Symbol.for("rp")] = 1;
  out.push(r1.n, r2.n, keys(r1), keys(r2), Object.getOwnPropertySymbols(r1).length, Object.getOwnPropertySymbols(r2).length);
  out.push(delete r2.label, "label" in r2, r2.label, "label" in r1, r1.label, keys(r2), desc(r2, "n"), desc(r1, "n"));
  r2.n = 20; r2.extra = "e";
  out.push(keys(r2), "extra" in r1);
  out.push(r2.n, r1.n);
  Object.freeze(r1);
  out.push(Object.isFrozen(r1), Object.isFrozen(r2), Reflect.set(r1, "n", 99), r1.n, desc(r1, "n"));
  out.push(Array.isArray(t1), t1.length, t2.length, t1[0], t2[1], keys(t1), JSON.stringify(t1), JSON.stringify(t2));
  t1[0] = 5;
  out.push(t1[0], t2[0], JSON.stringify(r1), JSON.stringify(r2));
  globalThis.__recordPair = [r1, r2, t1, t2];
  return out.join(" ");
};
globalThis.auditRecordPairKept = () => globalThis.__recordPair;

// Keys the page adds to a compiled record before reshaping it (a delete or
// freeze) keep JS order: the record's fields first, then the additions.
globalThis.auditRecordAdoptOrder = (r, s) => {
  const out = [];
  r.extra = "e"; r[Symbol.for("ao")] = 1; r[7] = "i";
  out.push(Object.keys(r).join(","), delete r.label, Object.keys(r).join(","), Object.getOwnPropertySymbols(r).length, JSON.stringify(r));
  s.extra = "f";
  Object.freeze(s);
  out.push(Object.keys(s).join(","), JSON.stringify(s), Object.isFrozen(s));
  return out.join(" ");
};

// Expando probes: compiled values stored on page objects (React-DOM's fiber
// and props keys on DOM nodes), read and checked by the page itself.
globalThis.auditExpandoNode = () => ({ id: "node" });
globalThis.auditExpandoRead = (node, key) => {
  const v = node[key];
  return [typeof v, v === node[key], v?.tag, v === null || typeof v !== "object" ? "-" : Object.keys(v).join("+"), Array.isArray(v), key in node, Object.keys(node).includes(key)].join(",");
};
globalThis.auditExpandoKept = (node, key) => node[key] === kept;
globalThis.auditExpandoPin = (node, key) => { Object.defineProperty(node, key, { value: 1, configurable: false, enumerable: true }); };
// A page object whose setters see the value before the store returns: one
// calls back into compiled code, the other keeps the value and throws.
globalThis.auditExpandoHooks = (cb) => ({ set hook(v) { this.seen = v; cb(v); }, set boom(v) { this.thrown = v; throw new TypeError("boom"); } });
globalThis.auditExpandoHookKept = (node) => [node.seen === kept, node.thrown === undefined || node.thrown === kept].join(",");
globalThis.auditExpandoPass = (node, key, cb) => cb(node[key]);
// Every kind of page value entering compiled code (pre-classified host
// results, review §33): property reads, method results, callback this and
// arguments. The NaN carries the compiler's reserved undefined bit pattern.
{
  const nanBits = (() => { const b = new DataView(new ArrayBuffer(8)); b.setUint32(0, 1, true); b.setUint32(4, 0x7ff40000, true); return b.getFloat64(0, true); })();
  const kinds = [undefined, null, true, false, 0, -0, 1, -1, 2 ** 30 - 1, 2 ** 30, -(2 ** 30), -(2 ** 30) - 1, 2 ** 31, -(2 ** 31), 2 ** 53 + 2,
    1.5, -1.5, 0.1 + 0.2, NaN, nanBits, Infinity, -Infinity, "", "x", "12", "-0", "1e3", " 7 ", Symbol.for("classify"), Symbol("local"), 10n,
    { page: 1 }, function pageFn() { return "pf"; }, [1, 2]];
  const props = Object.fromEntries(kinds.map((v, i) => ["k" + i, v]));
  globalThis.classifyKinds = () => kinds;
  globalThis.classifyProps = () => props;
  globalThis.classifyAt = (i) => kinds[i];
  // Calls f once per kind: as this, then as each of up to five arguments.
  globalThis.classifyEach = (f) => kinds.map((v, i) => f.call(v, v, i, v, kinds[(i + 1) % kinds.length], v));
  globalThis.classifyEcho = (v) => v;
  globalThis.classifyArity = (f) => [f.call(1), f.call(2, "a"), f.call(3, "a", undefined), f.call(4, 1, 2, 3, 4), f.call(5, 1, 2, 3, 4, 5, 6)].join(" ");
}
// Page-made bigints (opaque to compiled code): equal by value, made separately, in the order a page bridge would hand them out (a physics body id).
globalThis.auditBig = () => ({ ids: [12345678901234567890n, 1n << 70n, -5n, 0n], again: [BigInt("12345678901234567890"), 2n ** 70n, -5n, -0n], text: "12345678901234567890" });
// A page-side DOM stand-in (DOM_DIRECT, js.dom.*): prototype methods and
// accessors as the DOM has them, plus the receivers a by-name call must
// still treat exactly: own and subclass overrides, a prototype patched
// later, plain objects, a Proxy, a frozen node and a throwing setter.
globalThis.auditDom = () => {
  const log = [];
  let reads = 0;
  class FakeNode {
    constructor(name) { this.name = name; this.kids = []; this.attrs = {}; this.text = ""; this.click = null; }
    appendChild(c) { this.kids.push(c); log.push("append:" + c.name); return c; }
    insertBefore(c, ref) { const i = ref === null ? this.kids.length : this.kids.indexOf(ref); this.kids.splice(i, 0, c); log.push("insert:" + c.name); return c; }
    removeChild(c) { this.kids.splice(this.kids.indexOf(c), 1); log.push("remove:" + c.name); return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); log.push("attr:" + k + "=" + v); }
    removeAttribute(k) { delete this.attrs[k]; log.push("unattr:" + k); }
    addEventListener(type, f, opts) { log.push("listen:" + type + ":" + typeof f + ":" + JSON.stringify(opts)); }
    contains(o) { log.push("contains"); return o === this || this.kids.includes(o); }
    focus(o) { log.push("focus:" + typeof o); }
    getBoundingClientRect() { log.push("rect"); return { width: 3, height: 4 }; }
    get nodeType() { reads++; return 1; }
    get ownerDocument() { return doc; }
    get firstChild() { return this.kids[0] ?? null; }
    get textContent() { return this.text; }
    set textContent(v) { this.text = String(v); log.push("text:" + this.text); }
    get onclick() { return this.click; }
    set onclick(f) { this.click = f; log.push("onclick:" + typeof f); }
  }
  class FakeText extends FakeNode { get nodeType() { reads++; return 3; } get nodeValue() { return this.text; } set nodeValue(v) { this.text = String(v); log.push("value:" + v); } }
  class Special extends FakeNode { appendChild(c) { log.push("special:" + c.name); return "special"; } }
  const doc = {
    createElement(tag, opts) { log.push("create:" + tag + (opts ? ":" + JSON.stringify(opts) : "")); return tag === "special" ? new Special(tag) : new FakeNode(tag); },
    createTextNode(t) { const n = new FakeText("#text"); n.text = String(t); return n; },
  };
  const own = new FakeNode("own");
  own.appendChild = function (c) { log.push("own:" + c.name + ":" + (this === own)); return 7; };
  const frozen = Object.freeze(new FakeNode("frozen"));
  const plain = { appendChild(x) { return "plain:" + x; }, setAttribute(a, b) { return [this === plain, a, b].join(","); }, nodeType: "plain", ownerDocument: null };
  const traps = [];
  const proxied = new Proxy(new FakeNode("proxied"), { get(t, k, r) { if (typeof k === "string") traps.push(k); return Reflect.get(t, k, r); }, set(t, k, v, r) { traps.push("set:" + String(k)); return Reflect.set(t, k, v, r); } });
  const throwing = { set textContent(v) { throw new RangeError("no text: " + v); }, get nodeType() { throw new RangeError("no type"); } };
  const fn = Object.assign(function pageFn() {}, { appendChild: (x) => "fn:" + x, nodeType: 9 });
  return {
    doc, own, frozen, plain, proxied, throwing, fn, Special, frozenPlain: Object.freeze({ textContent: 1 }), sym: Symbol("s"),
    log: () => { const s = log.join(" "); log.length = 0; return s; },
    reads: () => reads, traps: () => { const s = traps.join(","); traps.length = 0; return s; },
    patch: () => { const old = FakeNode.prototype.setAttribute; FakeNode.prototype.setAttribute = function (k, v) { log.push("patched:" + k); return old.call(this, k, v); }; },
    click: (node) => node.click(),
    attrs: (node) => JSON.stringify(node.attrs),
    names: (node) => node.kids.map((k) => k.name).join("+"),
  };
};
// A real DOM (jsdom, from react-probe/profile-deps beside the fork) for the
// experimentalDomMirror fixtures: one document per process, created on first
// use, with `window` global as a page's (the host finds the realm's Document
// there). Page-side probes act on nodes as page scripts would.
globalThis.auditRealDom = () => {
  if (!globalThis.__realDom) {
    const fork = new URL("../../", import.meta.url).pathname;
    const req = globalThis.process.getBuiltinModule("node:module").createRequire(fork + "../react-probe/profile-deps/package.json");
    const { JSDOM } = req("jsdom");
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.window = dom.window;
    const doc = dom.window.document, log = [], Node = dom.window.Node;
    globalThis.__realDom = {
      doc, win: dom.window, log: () => { const s = log.join(" "); log.length = 0; return s; },
      // Page code that changes mirrored nodes behind compiled code's back.
      prepend: (parent, tag) => { const n = doc.createElement(tag); parent.insertBefore(n, parent.firstChild); return n; },
      detach: (node) => { node.remove(); },
      adopt: (node) => { const other = doc.implementation.createHTMLDocument("other"); other.body.appendChild(node); return other; },
      wrap: (node) => { const w = doc.createElement("section"); node.parentNode.replaceChild(w, node); w.appendChild(node); return w; },
      names: (node) => [...node.childNodes].map((c) => c.nodeType === 1 ? c.localName : c.nodeType === 3 ? "#" + c.data : "?").join("+"),
      html: (node) => node.outerHTML,
      // A caught DOMException's name as page code reads it.
      errName: (e) => e.name,
      own: (node) => Object.keys(node).join(",") || "-",
      setOwn: (node, k, v) => { node[k] = v; },
      getOwn: (node, k) => node[k],
      click: (node) => node.click(),
      // Page code between two entries into compiled code (a return, or a
      // throw, out of the first), changing what the first one built.
      between: (build, read) => { const n = build(); n.insertBefore(doc.createElement("pre"), n.firstChild); n.lastChild.remove(); return read(n); },
      afterThrow: (build, read) => { let n; try { build((x) => { n = x; }); } catch (e) { n.appendChild(doc.createElement("late")); return read(n); } return "no throw"; },
      // Compiled code calling page code that calls compiled code back, then
      // changes what the inner call built before returning to the outer one.
      returnThenMutate: (build) => { const n = build(); n.appendChild(doc.createElement("tail")); },
      throwThenMutate: (build) => { let n; try { build((x) => { n = x; }); } catch (e) { n.appendChild(doc.createElement("tail")); } },
      // A callback compiled code runs in the middle of its work.
      mutateLater: (parent) => () => { parent.textContent = ""; parent.appendChild(doc.createTextNode("page")); },
      overrideAppend: (node) => { node.appendChild = function (c) { log.push("own-append:" + c.nodeName); return Node.prototype.appendChild.call(this, c); }; },
      overrideCreate: () => { const orig = doc.createElement; doc.createElement = function (t) { log.push("own-create:" + t); return orig.call(this, t); }; return () => { delete doc.createElement; }; },
      defineCustom: () => { dom.window.customElements.define("x-probe", class extends dom.window.HTMLElement { connectedCallback() { log.push("connected:" + this.localName); } }); },
    };
  }
  return globalThis.__realDom;
};
// A dyn facade's target as the page can reach it: only symbol keys go
// there, through the target's prototype chain (Object.prototype additions,
// well-known symbols), and nothing else of the target shows.
globalThis.auditFacadeTarget = (o, arr) => {
  const s = Symbol.for("facade-target"), out = [];
  out.push(Object.prototype.toString.call(o), Object.prototype.toString.call(arr), Symbol.iterator in o, Symbol.iterator in arr, typeof o[Symbol.iterator], typeof arr[Symbol.iterator]);
  out.push(o.constructor === Object, arr.constructor === Array, Object.getPrototypeOf(o) === Object.prototype, Array.isArray(arr), "constructor" in o, Object.keys(o).join("+"));
  Object.prototype[s] = "inherited";
  try { out.push(o[s], s in o, arr[s], Object.getOwnPropertySymbols(o).length, Reflect.ownKeys(o).length, JSON.stringify(o)); }
  finally { delete Object.prototype[s]; }
  out.push(o[s], s in o, Object.isExtensible(o), String(Object.getOwnPropertyDescriptor(o, s)));
  o[Symbol.toStringTag] = "Tagged";
  out.push(Object.prototype.toString.call(o), Object.getOwnPropertySymbols(o).length, Reflect.ownKeys(o).length, delete o[Symbol.toStringTag], Object.prototype.toString.call(o));
  return out.join(" ");
};
// A compiled array with named own properties as the page sees it (its facade's traps): keys and their order,
// descriptors, set, delete and define.
globalThis.auditArrayFacade = (a) => {
  const out = [];
  out.push(Object.keys(a).join(","), Reflect.ownKeys(a).join(","), "index" in a, Object.prototype.hasOwnProperty.call(a, "input"), Array.isArray(a));
  out.push(JSON.stringify(Object.getOwnPropertyDescriptor(a, "index")), JSON.stringify(Object.getOwnPropertyDescriptor(a, "length")), String(Object.getOwnPropertyDescriptor(a, "nope")));
  a.extra = "e"; a.index = 42;
  out.push(a.extra, a.index, Object.keys(a).join(","), JSON.stringify(a));
  out.push(delete a.extra, "extra" in a, Object.keys(a).join(","));
  Object.defineProperty(a, "vis", { value: 2, writable: true, enumerable: true, configurable: true });
  out.push(a.vis, Object.keys(a).join(","), JSON.stringify(Object.entries(a).slice(-2)));
  const copy = { ...a };
  out.push(Object.keys(copy).join(","));
  return out.join(" ; ");
};
// The array iteration protocol as the page may change it (ts-any-array-pattern):
// each w5Patch mode replaces one piece until "restore"; w5Hits reports and
// resets how often the replacement ran.
{
  const AP = Array.prototype, AIP = Object.getPrototypeOf([][Symbol.iterator]());
  const values = AP[Symbol.iterator], next = AIP.next;
  let hits = 0;
  globalThis.w5Patch = (mode) => {
    if (mode === "values") AP[Symbol.iterator] = function* () { hits++; for (let i = 0; i < this.length; i++) yield "p" + this[i]; };
    else if (mode === "getter") Object.defineProperty(AP, Symbol.iterator, { configurable: true, get() { hits++; return values; } });
    else if (mode === "next") AIP.next = function () { hits++; return next.call(this); };
    else if (mode === "return") AIP.return = function () { hits++; return { done: true }; };
    else if (mode === "inherited") Object.prototype.return = function () { hits++; return { done: true }; };
    else {
      Object.defineProperty(AP, Symbol.iterator, { value: values, writable: true, enumerable: false, configurable: true });
      AIP.next = next;
      delete AIP.return;
      delete Object.prototype.return;
    }
  };
  globalThis.w5Hits = () => { const h = hits; hits = 0; return h; };
  globalThis.w5OwnIterator = (a) => { a[Symbol.iterator] = function* () { yield "own"; yield "iter"; }; };
}
// A canvas stand-in (Node has no OffscreenCanvas): a plain page object with
// a canvas's size fields.
globalThis.auditCanvas = (width, height) => ({ width, height, getContext: () => null });
// Calls a compiled callback from the page with a typed array and a promise.
globalThis.auditCallWithBytes = (cb) => cb(new Uint8Array([3, 5, 7]), Promise.resolve(11), { width: 2, height: 3 });

// Typed host modules (HOST_IMPORT_ABI section 7) a fixture may import: `host:test-host`, a plain-JS implementation the harness
// supplies to instantiateWasmGc({ modules }) (run-wasm.mjs answers it under any `<scheme>:test-host` a fixture declares). Sync and Promise-returning functions of every ABI result kind, and a rejection.
globalThis.__fixtureHostModules = {
  // wildcard-module-imports.ts: two page modules behind one `*?pagemod` declaration.
  "./alpha.txt?pagemod": { default: "alpha" },
  "./beta.txt?pagemod": { default: "beta" },
  "host:test-host": {
    syncNumber: (a, b) => a * b,
    syncBool: (x) => !x,
    syncString: (s) => s.toUpperCase(),
    syncObject: (o) => o,
    syncBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i + 1),
    syncBytesIn: (bytes) => bytes.reduce((a, b) => a + b, 0),
    asyncBytes: (n) => new Promise((resolve) => setTimeout(() => resolve(Uint8Array.from({ length: n }, (_, i) => 10 + i)), 1)),
    asyncBytesIn: (bytes) => { const copy = bytes.slice().reverse(); return Promise.resolve(copy); },
    syncVoid: (n) => { globalThis.__hostVoidCalls = (globalThis.__hostVoidCalls ?? 0) + n; },
    asyncNumber: (a) => new Promise((resolve) => setTimeout(() => resolve(a + 0.5), 1)),
    asyncBool: (x) => Promise.resolve(!x),
    asyncString: (s) => new Promise((resolve) => setTimeout(() => resolve(s + "!"), 1)),
    asyncObject: (o) => Promise.resolve(o),
    asyncVoid: () => new Promise((resolve) => setTimeout(resolve, 1)),
    asyncReject: (message) => Promise.reject(new Error(message)),
    asyncThrow: (message) => { throw new TypeError(message); },
  },
};
