// JSON.stringify of class instances and functions (jsonStringify:object / :func): own enumerable data properties,
// functions left out of objects, null in arrays, and undefined at the root.
class Point { constructor(public x: number, public y: number) {} norm(): number { return Math.hypot(this.x, this.y); } }
class Labeled extends Point { label = "p"; tags: string[] = ["a"]; }
interface Holder { point: Point; name: string; onChange: () => void; list: Point[] }
const holder: Holder = { point: new Point(1, 2), name: "h", onChange: () => {}, list: [new Labeled(3, 4)] };
console.log(JSON.stringify(new Point(5, 6)), JSON.stringify(new Labeled(7, 8)));
console.log(JSON.stringify(holder));
console.log(JSON.stringify(holder, null, 2));
const fns: (() => number)[] = [() => 1];
console.log(JSON.stringify(fns));
