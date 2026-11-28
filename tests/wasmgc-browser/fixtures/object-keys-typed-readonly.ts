// @native-only
// `const keys: string[] = Object.keys(x)` read only through `.length` and `[i]` shares one typed key array per key list;
// a local that escapes, is written or is sorted gets its own array. Every form must still see the object's current keys.
function shallowEqual(objA: unknown, objB: unknown): boolean {
  if (typeof objA !== "object" || objA === null || typeof objB !== "object" || objB === null) return false;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if ((objA as Record<string, unknown>)[k] !== (objB as Record<string, unknown>)[k]) return false;
  }
  return true;
}
function joined(o: object): string {
  const keys = Object.keys(o);
  let out = "";
  for (let i = 0; i < keys.length; i++) out += (i ? "," : "") + keys[i];
  return out + "/" + keys.length + "/" + String(keys[keys.length]);
}
function sortedKeys(o: object): string[] {
  const keys = Object.keys(o);
  keys.sort();
  return keys;
}
function escaping(o: object): string[] {
  const keys = Object.keys(o);
  return keys;
}
function pushed(o: object): number {
  const keys = Object.keys(o);
  keys.push("extra");
  return keys.length;
}

const a: any = { x: 1, y: "s" }, b: any = { x: 1, y: "s" }, c: any = { x: 2, y: "s" };
console.log(shallowEqual(a, b), shallowEqual(a, c), shallowEqual(a, {}), shallowEqual({}, {}));
const shapes: any[] = [{ p: 1 }, { p: 1, q: 2 }, { r: 3 }, { p: 1 }, { 2: "two", 1: "one", z: 0 }];
for (const s of shapes) console.log(joined(s));
const grow: any = { m: 1 };
console.log(joined(grow));
grow.n = 2;
console.log(joined(grow));
const other: any = { n: 1 };
other.m = 2;
console.log(joined(other), shallowEqual(grow, other));
for (let i = 0; i < 40; i++) grow["k" + i] = i;
console.log(joined(grow).length, shallowEqual(grow, grow));
const s1 = sortedKeys({ b: 1, a: 2 });
console.log(s1.join(","), joined({ b: 1, a: 2 }));
const e1 = escaping({ u: 1, v: 2 }), e2 = escaping({ u: 3, v: 4 });
e1.push("w");
console.log(e1.join(","), e2.join(","), joined({ u: 5, v: 6 }));
console.log(pushed({ u: 1 }), joined({ u: 1 }));
class Point { x = 1; y = 2; }
console.log(joined(new Point()), shallowEqual(new Point(), new Point()), shallowEqual(new Point(), { x: 1, y: 2 }));
console.log(joined([7, 8, 9]), joined("hi" as unknown as object));
