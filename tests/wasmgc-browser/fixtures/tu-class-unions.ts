// Unions of several reference types (sibling classes, a class and its
// subclass, discriminated records) with or without null/undefined are held
// as the reference itself: the arm is found by type test, a subclass before
// its base, so instanceof, overrides, discriminant reads, equality and
// narrowing behave as in JavaScript.
class Shape { kind = "shape"; area(): number { return 0; } describe(): string { return this.kind + ":" + this.area(); } }
class Circle extends Shape { r: number; constructor(r: number) { super(); this.kind = "circle"; this.r = r; } area(): number { return 3 * this.r * this.r; } }
class Square extends Shape { s: number; constructor(s: number) { super(); this.kind = "square"; this.s = s; } area(): number { return this.s * this.s; } }
class Ring extends Circle { inner: number; constructor(r: number, inner: number) { super(r); this.kind = "ring"; this.inner = inner; } area(): number { return super.area() - 3 * this.inner * this.inner; } }

function pick(i: number) { return i % 3 === 0 ? new Circle(i) : i % 3 === 1 ? new Square(i) : new Ring(i, 1); }
const xs = [pick(0), pick(1), pick(2), pick(3), pick(4), pick(5)];
let total = 0, rings = 0, circles = 0;
for (let i = 0; i < xs.length; i++) {
  const x = xs[i]!;
  total += x.area();
  if (x instanceof Ring) rings++;
  if (x instanceof Circle) circles++;
}
console.log(total, rings, circles, xs.map(x => x.kind).join(","), xs.map(x => x.describe()).join(" "));

// A class and its own subclass in one union: the subclass instance is the subclass arm.
function either(i: number): Circle | Ring { return i > 1 ? new Ring(i, 1) : new Circle(i); }
const e1 = either(1), e2 = either(2);
const crOut: string[] = [];
for (const v of [e1, e2] as (Circle | Ring)[]) crOut.push(v.kind);
console.log(e1 instanceof Ring, e2 instanceof Ring, e2 instanceof Circle, e1.area(), e2.area(), e1 === e2, e2 === e2, crOut.join(","));
const e3: Circle | Ring = e2;
console.log(e3 instanceof Ring ? e3.inner : -1, e3.r);

// With null and undefined arms.
function maybe(i: number): Circle | Square | null | undefined { return i === 0 ? null : i === 1 ? undefined : i % 2 ? new Square(i) : new Circle(i); }
const ms: (Circle | Square | null | undefined)[] = [maybe(0), maybe(1), maybe(2), maybe(3)];
console.log(ms.map(m => m === null ? "null" : m === undefined ? "undef" : m.kind).join(","), ms.map(m => m?.area() ?? -1).join(","), ms.map(m => (m ? 1 : 0)).join(""));
console.log(ms.filter((m): boolean => m != null).length, ms.indexOf(null), ms.indexOf(undefined), ms.indexOf(ms[3]), ms[2] === ms[2], ms[2] === ms[3]);
let cur: Circle | Square | null = ms[3] ?? null;
cur = cur === null ? null : cur instanceof Square ? new Circle(cur.s) : cur;
console.log(cur?.kind, cur instanceof Circle ? cur.r : -1);

// Discriminated records.
type Move = { t: "move"; dx: number; dy: number };
type Say = { t: "say"; text: string };
type Quit = { t: "quit" };
function cmd(i: number): Move | Say | Quit { return i % 3 === 0 ? { t: "move", dx: i, dy: -i } : i % 3 === 1 ? { t: "say", text: "hi" + i } : { t: "quit" }; }
const log: string[] = [];
let x = 0, y = 0;
for (let i = 0; i < 7; i++) {
  const c = cmd(i);
  switch (c.t) {
    case "move": x += c.dx; y += c.dy; log.push("m"); break;
    case "say": log.push(c.text); break;
    case "quit": log.push("q"); break;
  }
}
console.log(x, y, log.join(","), JSON.stringify([cmd(0), cmd(1), cmd(2)]));
const pending = new Map<string, Move | Say | null>();
pending.set("a", cmd(3) as Move); pending.set("b", null);
const pa = pending.get("a"), pb = pending.get("b"), pc = pending.get("c");
console.log(pa?.t, pb === null, pc === undefined, pa !== null && pa !== undefined && pa.t === "move" ? pa.dx : 0);
