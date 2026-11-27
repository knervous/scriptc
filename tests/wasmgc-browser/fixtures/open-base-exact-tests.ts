// @native-only: engine dyn does not compile Error subclasses
class Animal { name: string; constructor(name: string) { this.name = name; } speak(): string { return this.name + "?"; } }
class Dog extends Animal { speak(): string { return this.name + " woof"; } }
class Puppy extends Dog { speak(): string { return this.name + " yip"; } }
class Lone { n = 1; }
class MyError extends Error { code = 7; }
function kind(x: any): string {
  return [x instanceof Animal, x instanceof Dog, x instanceof Puppy, x instanceof Lone, x instanceof Error, x instanceof MyError].map((b) => (b ? 1 : 0)).join("");
}
const things: any[] = [new Animal("a"), new Dog("d"), new Puppy("p"), new Lone(), new Error("e"), new MyError("m"), new TypeError("t"), {}, [], "s", null];
console.log(things.map(kind).join(" "));
const animals: Animal[] = [new Animal("a"), new Dog("d"), new Puppy("p")];
console.log(animals.map((a) => a.speak()).join(","), animals.map((a) => (a instanceof Dog ? "dog" : "animal")).join(","));
function asAny(x: any): string { return x instanceof Animal ? (x as Animal).speak() : typeof x; }
console.log(asAny(new Puppy("q")), asAny(new Lone()), asAny(5));
// plain and regex-match string arrays share one layout family
const plain = ["x", "y"];
const m = "abc123".match(/([a-z]+)(\d+)/);
console.log(Array.isArray(plain), Array.isArray(m), plain.join("|"), m ? m[1] + ":" + m[2] + ":" + m.index : "none");
const mixed: any[] = [plain, m, { a: 1 }, new Dog("z")];
console.log(mixed.map((v) => (Array.isArray(v) ? "arr" + v.length : v instanceof Animal ? "animal" : typeof v)).join(","));
// dynamic objects and typed records through any
const rec = { id: 1, tag: "t" };
const objs: any[] = [rec, Object.create(null), { ...rec, extra: 2 }, new Map(), new Date(0)];
console.log(objs.map((o) => (o && typeof o === "object" ? Object.keys(o).length : -1)).join(","));
try { throw new MyError("boom"); } catch (e) { console.log(e instanceof MyError, e instanceof Error, String(e)); }
