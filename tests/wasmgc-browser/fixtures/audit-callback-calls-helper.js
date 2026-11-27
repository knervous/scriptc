// Array callbacks in JavaScript: arity, defaults, rest, arguments, this and
// thisArg, throwing callbacks, bound/page functions and class methods,
// predicate result kinds, index and array identity.
class K { m(x) { return x + 1; } static s(x) { return x - 1; } }
export function calls(pageFn) {
  const out = [];
  const t = (label, f) => { try { out.push(label + "=" + String(f())); } catch (e) { out.push(label + "!" + e.name + ":" + e.message); } };
  const mk = () => JSON.parse("[1, 2, 3, 4]");
  t("p0", () => mk().map(() => 7).join());
  t("p3", () => mk().map((x, i, a) => x + i + a.length).join());
  t("p4", () => mk().map((x, i, a, e) => [x, i, a.length, e].join("/")).join());
  t("dflt", () => mk().map((x, i = 100) => x + i).join());
  t("dflt4", () => { let n = 0; return mk().map((x, _i, _a, d = ++n) => x + d).join() + "|" + n; });
  t("rest", () => mk().map((...args) => args.length).join());
  t("rest2", () => mk().map((x, ...args) => x + args.length).join());
  t("args", () => mk().map(function (x) { return arguments.length + ":" + arguments[1]; }).join());
  const self = { k: 10 };
  t("thisFn", () => mk().map(function (x) { return this.k + x; }, self).join());
  t("thisFnNone", () => mk().map(function () { return typeof this; }).join());
  t("thisFind", () => mk().find(function (x) { return this.k === x * 5; }, self));
  t("thisFilter", () => mk().filter(function (x) { return x < this.k / 4; }, self).join());
  t("thisSome", () => mk().some(function (x) { return this === self && x === 4; }, self));
  t("thisEvery", () => mk().every(function () { return this === self; }, self));
  t("thisForEach", () => { let s = 0; mk().forEach(function (x) { s += this.k * x; }, self); return s; });
  t("thisFindIndex", () => mk().findIndex(function (x) { return this.k === x * 10; }, self));
  t("throwMap", () => mk().map((x) => { if (x === 3) throw new RangeError("at3"); return x; }));
  t("throwFind", () => mk().find((x) => { if (x === 2) throw new TypeError("at2"); return false; }));
  let visits = 0;
  t("throwForEach", () => mk().forEach((x) => { visits++; if (x === 2) throw new Error("stop"); }));
  out.push("visits=" + visits);
  t("spliceForEach", () => { const a = mk(); const seen = []; a.forEach((x, i) => { seen.push(x + "@" + i); if (i === 0) a.splice(1, 1); }); return seen.join(); });
  t("unshiftForEach", () => { const a = mk(); const seen = []; a.forEach((x, i) => { seen.push(x + "@" + i); if (i === 0) a.unshift(0); }); return seen.join(); });
  t("growEvery", () => { const a = mk(); let n = 0; a.every((x) => { n++; a.push(x); return true; }); return n + "|" + a.length; });
  t("holeFind", () => { const a = mk(); const seen = []; a.find((x, i) => { seen.push(x); if (i === 0) delete a[2]; return false; }); return seen.join(); });
  t("holeForEach", () => { const a = mk(); const seen = []; a.forEach((x, i) => { seen.push(x); if (i === 0) delete a[2]; }); return seen.join(); });
  t("numPred", () => mk().filter((x) => x - 2).join());
  t("nanPred", () => mk().filter((x) => (x === 1 ? NaN : x)).join());
  t("negZero", () => mk().some(() => -0));
  t("strPred", () => mk().filter((x) => (x > 2 ? "y" : "")).join());
  t("objPred", () => mk().find((x) => (x > 2 ? {} : null)));
  t("boolMap", () => mk().map((x) => x > 2).join());
  t("voidMap", () => mk().map((_x) => { }).join("|"));
  function named(x) { return x * 3; }
  t("named", () => mk().map(named).join());
  t("bound", () => mk().map(named.bind(null)).join());
  t("boundThis", () => mk().map(function (x) { return this.k + x; }.bind({ k: 100 }), self).join());
  t("pageFn", () => mk().map(pageFn).join());
  const k = new K();
  t("method", () => mk().map(k.m).join());
  t("static", () => mk().map(K.s).join());
  t("asyncCb", () => mk().map(async (x) => x).length);
  t("idxType", () => mk().map((_x, i) => typeof i + (i === 1)).join());
  t("arrIdentity", () => { const a = mk(); return a.every((_x, _i, arr) => arr === a); });
  t("cbReassign", () => { let cb = (x) => x * 2; return mk().map((x) => { const r = cb(x); cb = () => 0; return r; }).join(); });
  t("reduce", () => mk().reduce((acc, x, i, a) => acc + x * i + a.length, 0));
  return out.join("\n");
}
