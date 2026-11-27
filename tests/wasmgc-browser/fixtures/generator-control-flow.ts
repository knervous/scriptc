function* flow(n: number): Generator<number, string, number> {
  let sum = 0;
  outer: for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      if (j === 2) continue outer;
      if (i === 3) break outer;
      sum += yield i * 10 + j;
    }
  }
  let k = 0;
  do { yield k; k++; } while (k < 2);
  while (true) { if (k++ > 4) break; yield k; }
  if (sum > 0) yield 100; else yield 200;
  const t = sum > 1 ? (yield 7) : (yield 8);
  const u = (yield 1) + (yield 2) * (yield 3);
  return "fin" + sum + ":" + t + ":" + u;
}
const g = flow(5);
let r = g.next(0);
for (let step = 1; !r.done; step += 1) { console.log(r.value); r = g.next(step); }
console.log(r.value);
