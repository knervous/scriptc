// @native-any-only: untyped collections as TS any (the engine and plain native lanes keep these values in the page)
// Iterator helpers resolve on the compiled Map, Set and Array iterators (the web host chains them to the page's Iterator.prototype).
const m: any = new Map<any, any>([["a", 1], ["b", 2], ["c", 3]]);
const s: any = new Set<any>([5, 6, 7, 8]);
const a: any = [10, 20, 30];
console.log(JSON.stringify(m.keys().map((k: string) => k + "!").toArray()), JSON.stringify(a.values().map((x: number) => x / 10).toArray()));
console.log(JSON.stringify(s.values().filter((x: number) => x % 2 === 0).toArray()), JSON.stringify(m.entries().take(2).toArray()), JSON.stringify(s.values().drop(3).toArray()));
const pair = (x: number): any => [x, x + 1];
const fm: any = a.values().flatMap(pair);
console.log(JSON.stringify(fm.toArray()), a.values().reduce((p: number, x: number) => p + x, 0), a.values().reduce((p: number, x: number) => p + x));
console.log(s.values().some((x: number) => x > 7), s.values().every((x: number) => x > 5), m.values().find((x: number) => x > 1));
const seen: any[] = [];
a.keys().forEach((i: number) => seen.push(i));
console.log(JSON.stringify(seen));
