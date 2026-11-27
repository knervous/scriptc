// @native-only: Object.keys over a class-backed structural view needs the native dyn model (the engine model refuses it loudly)

class Counter { count = 0; label = "c"; }
class Point { x = 1; y = 2; label = "p"; }
type XY = { x: number; y: number };
function add(o: { count: number }, n: number): void { o.count += n; }
const c = new Counter();
add(c, 3);
add(c, 4);
console.log(c.count);
const p = new Point();
const view: XY = p;
console.log(view === (p as XY));
p.x = 5;
console.log(JSON.stringify(view), Object.keys(view).join(","));
function show(o: { x: number }): string { o.x++; return JSON.stringify(o) + " " + Object.keys(o).join(","); }
const plain = { x: 5 };
console.log(show(new Point()), show(plain), show({ x: 9 }), plain.x);
