function* count(n: number): Generator<number, string, void> {
  for (let i = 0; i < n; i++) yield i * 2;
  return "done";
}
const g = count(3);
let r = g.next();
while (!r.done) { console.log("v", r.value); r = g.next(); }
console.log("ret", r.value, g.next().done);
