// @native-any-only: a TS class instance held as `any` is a native dyn value only under native-any
// Object.values/entries read a class instance's own fields from its slots
// (they had read undefined: the generic dyn read sees no class fields).
class A { v = 1; w = "s"; m(): number { return 2; } }
const x: any = new A();
console.log(("v" in x) + " " + ("m" in x) + " " + ("constructor" in x) + " " + ("zz" in x));
console.log(Object.keys(x).join(",") + " " + JSON.stringify(Object.values(x)) + " " + JSON.stringify(Object.entries(x)) + " " + Object.prototype.hasOwnProperty.call(x, "v"));
