// @native-any-only: arrays of unknown/any (deps arrays, listener arrays, rest parameters, `new Array(n)`) in typed code.
type Listener = (e: unknown) => void;
const listeners: Array<Listener> = [];
const lists: Map<string, unknown[]> = new Map();
interface Cache { data: Array<Array<any>>; index: number }
function depsEqual(next: ReadonlyArray<unknown>, prev: ReadonlyArray<unknown> | null): boolean {
  if (prev === null) return false;
  for (let i = 0; i < prev.length && i < next.length; i++) if (!Object.is(next[i], prev[i])) return false;
  return true;
}
function inspect(v: unknown): string {
  if (Array.isArray(v)) return "arr" + v.length + typeof v[0];
  return "other";
}
function count(...args: unknown[]): number { return args.length; }
function anyCount(first: number, ...args: any[]): string { return first + ":" + args.join("|"); }
const a: unknown[] = [1, "b"];
const b = [...a, { z: 1 }];
lists.set("k", b);
listeners.push((e) => console.log("L", String(e)));
listeners.forEach((l) => l(42));
console.log(depsEqual(a, a), depsEqual(a, [1, "c"]), inspect(a), inspect(3), a.map((x) => String(x)).join(), lists.get("k")!.length);
console.log(count(), count(1, 2, a), anyCount(1), anyCount(1, "x", 2));
const arrow = (...args: unknown[]) => args.length;
console.log(arrow(1, 2, 3));
const c: Cache = { data: [], index: 0 };
const data = c.data[c.index] = new Array(3);
for (let i = 0; i < 3; i++) data[i] = i * 2;
const holes: unknown[] = new Array(2);
console.log(data.length, data[2], c.data.length, holes.length, holes[0] === undefined);
