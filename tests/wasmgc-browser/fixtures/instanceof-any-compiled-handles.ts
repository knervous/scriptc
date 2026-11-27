// @options: {"hostHandles": true}
// A compiled value held in `any` against its own class and builtin constructors: a page-held compiled error is a real Error of its class, a class
// instance is an instance of its class and bases only, collections and promises are none of the program's classes (never a silent false).
class Animal { legs = 4; }
class Dog extends Animal {}
class Rock {}
class AppError extends Error { constructor(m: string) { super(m); this.name = "AppError"; } }
class DeepError extends AppError {}
function who(v: any): string {
  return (v instanceof Dog ? "Dog" : v instanceof Animal ? "Animal" : v instanceof Rock ? "Rock" : v instanceof DeepError ? "DeepError" : v instanceof AppError ? "AppError" : "other");
}
const out: string[] = [];
out.push([who(new Animal()), who(new Dog()), who(new Rock()), who({}), who(3), who("s"), who(null), who(undefined), who([1]), who(new Map()), who(Promise.resolve(1)), who(new Date(1))].join());
out.push([who(new AppError("a")), who(new DeepError("d")), who(new Error("e")), who(new TypeError("t"))].join());
const t: any = new TypeError("t"), r: any = new RangeError("r"), e: any = new Error("e"), de: any = new DeepError("d");
out.push([t instanceof Error, t instanceof TypeError, t instanceof RangeError, r instanceof Error, r instanceof RangeError, r instanceof TypeError, e instanceof Error, e instanceof TypeError].join());
out.push([de instanceof Error, de instanceof AppError, de instanceof DeepError, de.message, de.name, String(de), typeof de].join());
out.push([t.message, t.name, String(t), e.message, e.name].join());
const a: any = new Dog();
out.push([a instanceof Animal, a instanceof Dog, a instanceof Rock, a.legs].join());
const m: any = new Map(), p: any = Promise.resolve(1);
out.push([m instanceof Rock, p instanceof Rock, m instanceof Animal, p instanceof AppError].join());
console.log(out.join("\n"));
