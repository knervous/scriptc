function* sw(n: number): Generator<string, void, undefined> {
  for (let i = 0; i < n; i++) {
    switch (i % 3) {
      case 0:
        yield "zero";
        break;
      case 1:
        yield "one";
      case 2:
        yield "two-or-fall";
        break;
      default:
        yield "never";
    }
  }
}
for (const v of sw(4)) console.log(v);
function* labeled(): Generator<number, void, undefined> {
  blk: {
    yield 1;
    if (true) break blk;
    yield 2;
  }
  yield 3;
}
for (const v of labeled()) console.log(v);
function* ofArray(a: number[]): Generator<number, void, undefined> {
  for (const x of a) { if (x < 0) continue; yield x; }
}
for (const v of ofArray([1, -2, 3])) console.log(v);
function* ofString(s: string): Generator<string, void, undefined> {
  for (const ch of s) yield ch;
}
for (const v of ofString("héy")) console.log(v);
function* ofMap(m: Map<string, number>): Generator<string, void, undefined> {
  for (const [k, v] of m) yield k + v;
}
for (const v of ofMap(new Map([["a", 1], ["b", 2]]))) console.log(v);
