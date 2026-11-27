// Closures sharing their scope's captured variables (one scope struct per scope instance).
export function shared() {
  var out = [];
  function counter(start) {
    var n = start, step = 1, log = [];
    // (one signature for all four: an array of closures with different arities reads back wrong, a separate defect)
    var inc = function (_) { n += step; log.push(n); return n; };
    var setStep = function (s) { step = s; };
    var get = function (_) { return n + ":" + step + ":" + log.join("/"); };
    start = -1; // the parameter is captured too
    var peek = function (_) { return start; };
    return [inc, setStep, get, peek];
  }
  var a = counter(10), b = counter(100);
  a[0](0); a[1](5); a[0](0); b[0](0);
  out.push(a[2](0), b[2](0), a[3](0), b[3](0));
  // Fresh per loop iteration, shared within one.
  var fns = [];
  for (var i = 0; i < 3; i++) {
    let x = i * 10, y = "y" + i;
    fns.push(function () { return x + y; }, function () { x++; return x; });
  }
  out.push(fns[0](), fns[1](), fns[0](), fns[2](), fns[4](), fns[5](), fns[4]());
  // for-header bindings: one per iteration.
  var hs = [];
  for (let k = 0; k < 3; k++) hs.push(function () { return k; });
  out.push(hs.map(function (h) { return h(); }).join(","));
  // Nested scopes: a closure capturing from three levels.
  function outer(p) {
    var o1 = p + 1;
    return function middle(q) {
      var m1 = q * 2, m2 = "m";
      return function inner(r) { o1++; m1++; return [p, o1, q, m1, m2, r].join("."); };
    };
  }
  var f = outer(1)(2);
  out.push(f(3), f(4), outer(5)(6)(7));
  // Recursion: each call its own scope.
  function rec(n) { var mine = n; var get = function () { return mine; }; if (n > 0) { var inner = rec(n - 1); return get() + "," + inner; } return String(get()); }
  out.push(rec(4));
  // A named function expression referring to itself, with captures.
  var base = 3;
  var fact = function self(n) { return n <= 1 ? base - 2 : n * self(n - 1); };
  out.push(fact(5));
  // Blocks, try/catch/finally and switch scopes.
  var keep = [];
  { let bx = "block"; keep.push(function () { return bx; }); }
  try { let tx = "try"; keep.push(function () { return tx; }); throw new Error("e"); }
  catch (err) { let cx = "catch:" + err.message; keep.push(function () { return cx + "/" + err.message; }); }
  finally { let fx = "finally"; keep.push(function () { return fx; }); }
  switch (keep.length) { case 4: let sx = "switch"; keep.push(function () { return sx; }); break; default: keep.push(function () { return "default"; }); }
  out.push(keep.map(function (k) { return k(); }).join(","));
  // Closures over variables written after the closure was made.
  var later = "before"; var seeLater = function () { return later; }; later = "after";
  out.push(seeLater());
  // Many captured variables, a closure using only some of them.
  var c1 = 1, c2 = 2, c3 = 3, c4 = 4, c5 = 5;
  var sum = function () { return c1 + c3 + c5; }, bump = function () { c2 += 10; c4 += 10; return c2 + c4; };
  out.push(sum(), bump(), sum(), c2, c4);
  return out.join(" ; ");
}
// Callbacks passed straight to array methods, capturing locals of each call.
export function callbacks(n, wanted) {
  var rows = []; for (var i = 1; i <= n; i++) rows.push({ id: i });
  var hits = 0, label = "row";
  var found = rows.find(function (r) { hits++; return r.id === wanted; });
  var names = rows.filter(function (r) { return r.id !== wanted; }).map(function (r) { return label + r.id; });
  var any = rows.some(function (r) { return r.id > wanted; });
  return [found ? found.id : "none", hits, names.join("|"), any].join(" ; ");
}
// An async function capturing a variable that a synchronous closure shares.
export function withAsync() {
  var shared = 1;
  var bump = function () { shared++; return shared; };
  var later = async function () { await Promise.resolve(0); shared += 100; return shared; };
  bump();
  var p = later();
  bump();
  return p.then(function (v) { return [v, shared, bump()].join(","); });
}
// The same callback literals on receivers that are not compiled arrays: they get a real closure.
export function nonArrays(n, typed) {
  var count = 0, seen = [];
  var custom = { find: function (cb) { seen.push(typeof cb, cb(5), cb(6), cb === cb); return "custom"; } };
  var r1 = custom.find(function (x) { count++; return x > n; });
  var r2 = typed.find(function (x) { count++; return x > n; });
  var r3 = typed.some(function (x) { return x === n; });
  // A named literal that refers to itself (a closure of its own) from inside the walk.
  var arr = [1, 2, 3, 4];
  var r4 = arr.filter(function keep(x) { count++; return x !== n && typeof keep === "function"; });
  var r5 = arr.map(function (x) { return x * n + count; });
  return [r1, r2, r3, r4.join(","), r5.join(","), count, seen.join(",")].join(" ; ");
}
