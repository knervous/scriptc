// Conditional spreads with several properties, `undefined`/`null` empty arms,
// `c && {...}`, either orientation, both arms literal, and presence
// semantics: an absent arm leaves an earlier contributor's value alone.
interface Opts {
  a?: number;
  b?: string;
  c?: boolean;
  d: number;
  e?: string;
}
let evals = 0;
const tick = (n: number): number => { evals++; return n; };
function make(c: boolean, base: Opts): Opts {
  return {
    ...base,
    ...(c ? { a: tick(1), b: "on" } : {}),
    ...(c ? undefined : { c: true, e: "off" }),
  };
}
function andForm(c: boolean, n: number): Opts {
  return { d: n, ...(c && { a: tick(7), b: "and" }) };
}
function both(c: boolean): Opts {
  return { d: 0, ...(c ? { a: 1 } : { b: "no", e: "e" }) };
}
function nullArm(c: boolean): Opts {
  return { d: 1, ...(c ? null : { a: 9, c: false }) };
}
function defaultsKept(c: boolean): Opts {
  const defaults: Opts = { a: 100, b: "def", d: 5 };
  return { ...defaults, ...(c ? { a: 1 } : {}), ...(c ? { b: "x", d: 6 } : undefined) };
}
const show = (o: Opts): string =>
  `a=${o.a} b=${o.b} c=${o.c} d=${o.d} e=${o.e} has:${"a" in o ? "a" : ""}${"b" in o ? "b" : ""}${"c" in o ? "c" : ""}${"e" in o ? "e" : ""}`;
console.log(show(make(true, { d: 1 })));
console.log(show(make(false, { d: 1, a: 50, c: false })));
console.log("evals", evals);
console.log(show(andForm(true, 3)), show(andForm(false, 4)), "evals", evals);
console.log(show(both(true)), show(both(false)));
console.log(show(nullArm(true)), show(nullArm(false)));
console.log(show(defaultsKept(true)));
console.log(show(defaultsKept(false)));
// Overriding a conditional contributor afterwards keeps last-write-wins.
function later(c: boolean): Opts {
  return { d: 2, ...(c ? { a: tick(5), b: "cond" } : {}), a: 42 };
}
console.log(show(later(true)), show(later(false)), "evals", evals);
