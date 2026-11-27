// Reflect.get on a compiled class instance held untyped: its fields, accessors and methods, by constant and computed key, with
// and without an explicit receiver. The own-receiver read went to the generic atom read, which answered only Object's members
// (undefined for every field); a class instance is now answered as `value[key]` on it is.
class Point { x = 1; y = 2; get sum(): number { return this.x + this.y; } norm(): number { return this.x * this.x + this.y * this.y; } }
class Point3 extends Point { z = 3; }
const values: any[] = [new Point(), new Point3(), { x: 7 }];
const keys = ["x", "y", "z", "sum", "missing"];
for (const v of values) {
  console.log(Reflect.get(v, "x"), keys.map((k) => `${k}=${Reflect.get(v, k)}`).join(" "), Reflect.get(v, "sum", v), v["sum"], typeof Reflect.get(v, "norm"));
}
