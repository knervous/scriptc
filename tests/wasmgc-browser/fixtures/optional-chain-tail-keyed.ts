interface V { sub: { k: number }; s: Record<string, number> }
const rec: Record<string, V> = { a: { sub: { k: 1 }, s: { x: 5 } } };
const arr: V[] = [{ sub: { k: 2 }, s: { y: 6 } }];
function r1(k: string): number | undefined { return rec[k]?.sub.k; }
function r2(k: string, j: string): number | undefined { return rec[k]?.s[j]; }
function a1(i: number): number | undefined { return arr[i]?.sub.k; }
function a2(i: number, j: string): number | undefined { return arr[i]?.s[j]; }
console.log(r1("a"), r1("b"), r2("a", "x"), r2("a", "z"), r2("b", "x"));
console.log(a1(0), a1(5), a2(0, "y"), a2(0, "q"), a2(3, "y"));
function d(k: string): number { return rec[k]?.sub.k ?? -1; }
console.log(d("a"), d("zz"));
