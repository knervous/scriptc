// Captured bindings nothing writes after their initialization read through plain locals (ir/capture-values.ts).
// Every binding that IS written, anywhere, must keep its shared carrier and show each update.

// Consts and never-reassigned lets captured by closures; numbers as loop bounds and array indexes.
function sums(): string {
  const N = 64;
  let stride = 3;
  const data: number[] = [];
  for (let i = 0; i < N; i++) data.push(i * 2);
  const sumTo = (k: number): number => { let s = 0; for (let i = 0; i < N && i < k; i += stride) s += data[i]!; return s; };
  const at = (i: number): number => data[(i * stride) % N]!;
  const total = data.reduce((a, b) => a + b + N - N, 0);
  return `${sumTo(10)} ${sumTo(100)} ${at(5)} ${at(40)} ${total}`;
}
console.log("sums", sums());

// A let reassigned after capture: the closure sees the update.
function late(): string {
  let x = 1;
  const read = () => x;
  const first = read();
  x = 2;
  return `${first} ${read()}`;
}
console.log("late", late());

// A let assigned inside another closure.
function shared(): string {
  let count = 0;
  const bump = () => { count += 5; };
  const get = () => count;
  bump(); bump();
  const inc = () => count++;
  inc();
  return `${get()} ${count}`;
}
console.log("shared", shared());

// Loop-per-iteration bindings captured by callbacks.
function perIteration(): string {
  const fns: (() => number)[] = [];
  for (let i = 0; i < 4; i++) { const v = i * 10; const w = v + 1; fns.push(() => v + w); }
  const forOf: (() => string)[] = [];
  for (const s of ["a", "b", "c"]) { const t = s + s; forOf.push(() => t + s); }
  let j = 0;
  const whiles: (() => number)[] = [];
  while (j < 3) { const k = j * j; whiles.push(() => k); j++; }
  const loopLet: (() => number)[] = [];
  for (let i = 0; i < 3; i++) loopLet.push(() => i);
  return `${fns.map((f) => f()).join(",")} ${forOf.map((f) => f()).join(",")} ${whiles.map((f) => f()).join(",")} ${loopLet.map((f) => f()).join(",")}`;
}
console.log("perIteration", perIteration());

// Nested closures three deep, the innermost reading every level's binding.
function nested(): string {
  const a = 2;
  const outer = (b: number) => {
    const c = b + a;
    return (d: number) => {
      const e = d * c;
      return (f: number) => a + b + c + d + e + f;
    };
  };
  const g = outer(3)(4);
  let late = 1;
  const h = () => () => () => late;
  const deep = h()();
  late = 9;
  return `${g(5)} ${g(6)} ${outer(1)(1)(1)} ${deep()}`;
}
console.log("nested", nested());

// Captured objects whose FIELDS change: the binding is fixed, the object is not.
class Counter { n = 0; tags: string[] = []; }
interface Cfg { scale: number; name: string; items: number[] }
function mutable(): string {
  const c = new Counter();
  const cfg: Cfg = { scale: 2, name: "x", items: [1] };
  const map = new Map<string, number>();
  const tick = (k: string) => { c.n += cfg.scale; c.tags.push(k); cfg.items.push(c.n); map.set(k, (map.get(k) ?? 0) + 1); };
  tick("a"); cfg.scale = 10; tick("b"); tick("a");
  cfg.name = "y";
  const describe = () => `${c.n}/${c.tags.join("")}/${cfg.name}/${cfg.items.join(",")}/${map.get("a")}`;
  return describe();
}
console.log("mutable", mutable());

// Parameters: an unchanged number parameter captured, and one reassigned after capture.
function params(n: number, m: number): string {
  const f = () => n * 2;
  const g = () => m;
  m = m + 100;
  return `${f()} ${g()}`;
}
console.log("params", params(4, 5));

// Hoisted function declarations calling each other through captures.
function hoisted(x: number): string {
  const base = 7;
  function even(k: number): boolean { return k === 0 ? true : odd(k - 1); }
  function odd(k: number): boolean { return k === 0 ? false : even(k - 1); }
  function plus(k: number): number { return k + base; }
  return `${even(x)} ${odd(x)} ${plus(x)} ${[1, 2, 3].map(plus).join(",")}`;
}
console.log("hoisted", hoisted(10), hoisted(7));

// A sort comparator and per-entity update closures reading captured configuration.
function entities(): string {
  const speed = 3, limit = 20;
  const xs = [5, 1, 4, 2, 3];
  const desc = true;
  xs.sort((a, b) => (desc ? b - a : a - b));
  const pos = xs.map((x) => x);
  const step = () => { for (let i = 0; i < pos.length; i++) pos[i] = Math.min(limit, pos[i]! + speed); };
  step(); step();
  return `${xs.join(",")} ${pos.join(",")}`;
}
console.log("entities", entities());

// Catch bindings and a switch-case declaration stay boxed.
function misc(v: number): string {
  let out = "";
  try { throw new Error("e" + v); } catch (err) { const read = () => (err as Error).message; out += read(); }
  switch (v) {
    case 1: { const s = "one"; const f = () => s; out += f(); break; }
    default: { const s = "other"; const f = () => s; out += f(); }
  }
  return out;
}
console.log("misc", misc(1), misc(2));

// Special numbers keep their exact values (no literal propagation of -0, NaN, Infinity).
function special(): string {
  const z = -0, n = NaN, inf = 1 / 0, half = 1 / 2;
  const f = () => `${Object.is(z, -0)} ${Number.isNaN(n)} ${inf} ${half} ${1 / z}`;
  return f();
}
console.log("special", special());
