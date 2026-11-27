function* range(n: number): Generator<number, void, undefined> {
  for (let i = 0; i < n; i++) yield i;
}
let s = 0;
for (const x of range(5)) s += x;
console.log(s);
for (const x of range(10)) { if (x === 2) break; console.log("x", x); }
function* inner(): Generator<number, string, undefined> { yield 1; yield 2; return "r"; }
function* outer(): Generator<number, void, undefined> {
  const r = yield* inner();
  console.log("inner returned", r);
  yield* range(2);
  yield 3;
}
for (const x of outer()) console.log("o", x);
function* closing(): Generator<number, void, undefined> {
  try { yield 1; yield 2; } finally { console.log("closed"); }
}
for (const x of closing()) { console.log("c", x); break; }
