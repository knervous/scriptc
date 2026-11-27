// @options: {"interfaceClassArms": true}
// JSON.stringify of a record whose {x, y} slot also carries a class arm
// (a class instance flowed into that shape elsewhere): own enumerable fields
// in declaration order, as Node.
class Vec2 { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } length(): number { return Math.hypot(this.x, this.y); } }
interface Settings { name: string; stick: { x: number; y: number } | null; }
function place(p: { x: number; y: number }): number { return p.x + p.y; }
const sum = place(new Vec2(1, 2));
const a: Settings = { name: "a", stick: { x: 3, y: 4 } };
const b: Settings = { name: "b", stick: new Vec2(5, 6) };
const c: Settings = { name: "c", stick: null };
console.log(sum, JSON.stringify(a), JSON.stringify(b), JSON.stringify(c), JSON.stringify([a, c], null, 1).length);
