// react-dom's describeNativeComponentFrame shapes: "object" === typeof Reflect && Reflect.construct; Reflect.construct(fn, [], Fake).
function Fn(a) { this.a = a; }
function Fake() {}
function Ret() { this.own = 1; return { r: 2 }; }
function Probe() { this.seen = Object.getPrototypeOf(this) === Fake.prototype; }
Fake.prototype.tag = "fake";
function caught(f) { try { return String(f()); } catch (e) { return e.name; } }
export function run() {
  var out = [], R = Reflect;
  out.push(typeof Reflect, "object" === typeof Reflect && typeof Reflect.construct === "function" ? "has" : "none", R === Reflect, typeof Reflect.construct);
  var plain = Reflect.construct(Fn, [5]);
  out.push(plain.a, Object.getPrototypeOf(plain) === Fn.prototype);
  var viaTarget = Reflect.construct(Fn, [6], Fake);
  out.push(viaTarget.a, viaTarget.tag, Object.getPrototypeOf(viaTarget) === Fake.prototype);
  var ret = Reflect.construct(Ret, [], Fake);
  out.push(ret.r, ret.own, Object.getPrototypeOf(ret) === Object.prototype, Reflect.construct(Probe, [], Fake).seen);
  var construct = Reflect.construct;
  out.push(construct(Fn, [7]).a, Reflect.apply(Math.max, undefined, [1, 9, 3]), Reflect.has({ k: 1 }, "k"), Reflect.get({ z: 4 }, "z"));
  var o = {}; out.push(Reflect.set(o, "w", 8), o.w, Reflect.ownKeys(o).join(), Reflect.getPrototypeOf(o) === Object.prototype);
  out.push(Reflect.defineProperty(o, "d", { value: 1 }), o.d, caught(function () { return Reflect.construct(1, []); }));
  return out.join("|");
}
