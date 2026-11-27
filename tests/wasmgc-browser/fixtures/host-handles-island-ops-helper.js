// Operators over page-typed (any) operands that are compiled values: boxed numbers, strings, objects with valueOf / toString.
/** @type {any} */ var n3 = 3;
/** @type {any} */ var n10 = 10;
/** @type {any} */ var s2 = "2";
/** @type {any} */ var s10 = "10";
/** @type {any} */ var z = 0;
/** @type {any} */ var s0 = "";
/** @type {any} */ var fl = 1.5;
/** @type {any} */ var o5 = { valueOf: function () { return 5; } };
/** @type {any} */ var o7 = { valueOf: function () { return 7; } };
/** @type {any} */ var t2 = { toString: function () { return "2"; } };
/** @type {any} */ var arr2 = [2];
/** @type {any} */ var arr10 = [10];
/** @type {any} */ var nul = null;
/** @type {any} */ var und = undefined;
/** @type {any} */ var yes = true;
/** @type {any} */ var D = Date;
/** @type {any} */ var dt = new D(5);
/** @type {any} */ var dd = new D(0);
/** @type {any} */ var mth = Math;
/** @type {any} */ var jsn = JSON;
/** @type {any} */ var dfn = Date;
export function run() {
  var out = [];
  out.push([n3 > z, n3 < n10, n3 >= 3, n3 <= 2, fl > 1, z > 0, n10 > n3].join());
  out.push([s2 < s10, s2 > s10, s10 < s2, n3 < s10, s2 < n10, s2 >= "2", "b" > "a", "a" > "b"].join());
  out.push([o5 > n3, o5 < o7, o7 >= o5, o5 > "4", t2 < n3, t2 < s10, arr2 < arr10, arr2 < n10, o5 <= 5].join());
  out.push([nul >= z, nul > z, und > z, und < z, yes > z, nul <= z].join());
  out.push([n3 + n10, s2 + s10, n3 + s2, o5 + o7, o5 + "x", t2 + t2, arr2 + arr10, nul + n3, und + n3, yes + n3].join());
  out.push([n10 - n3, n10 * n3, n10 / 4, n10 % n3, n3 ** 2, o7 - o5, s10 - s2, s10 * 2, t2 * o5].join());
  out.push([-n3, +s2, +o5, -o7, +nul, +und, -yes].join());
  out.push([!n3, !z, !s2, !s0, !o5, !nul, !und, !arr2].join());
  out.push([String(n3), String(o5), String(t2), String(arr10), "" + yes].join());
  // A host object against a compiled number or string: the host runs its ToPrimitive, the operator runs compiled-side.
  out.push([dt > n3, dt < n3, dt > dd, dt + n3 === "Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)3" || typeof (dt + n3), typeof (dt + s2), (dt - n3), (dt * 2), dt >= 5, 5 <= dt].join());
  out.push([mth + s2, s2 + mth, typeof (dfn + s2), (dfn + s2).slice(0, 14), mth > n3, dd < dt, dt - dd, dt + dd === dt + dd].join());
  return out.join("\n");
}
