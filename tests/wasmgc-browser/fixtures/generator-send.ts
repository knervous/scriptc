function* acc(): Generator<number, string, number> {
  let total = 0;
  while (total < 10) {
    const x: number = yield total;
    total += x;
  }
  return "total " + total;
}
const g = acc();
console.log(JSON.stringify(g.next(0)));
console.log(JSON.stringify(g.next(3)));
console.log(JSON.stringify(g.next(4)));
console.log(JSON.stringify(g.next(5)));
console.log(JSON.stringify(g.next(1)));
