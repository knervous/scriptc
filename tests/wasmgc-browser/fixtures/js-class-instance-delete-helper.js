// A method added to a class instance under a computed key, then deleted: lookup falls back to the
// prototype chain (here a prototype method that is itself replaced, then deleted).
class Base { constructor(value = 2) { this.value = value; } scale(n) { return this.value * n; } }
class Child extends Base {}
export function run() {
  const out = [], c = /** @type {any} */ (new Child()), key = "scale";
  Child.prototype.scale = function (n) { return this.value + n + 10; };
  Base.prototype.scale = function (n) { return n + 100; };
  c[key] = function (n) { return this.value + n + 20; };
  out.push(c.scale(1), Object.hasOwn(c, key));
  delete c[key];
  out.push(c.scale(1), Object.hasOwn(c, key), key in c);
  delete /** @type {any} */ (Child.prototype).scale;
  out.push(c.scale(2));
  c.extra = 1; delete c.extra;
  out.push("extra" in c, Object.keys(c).join(","));
  return out.join(" ");
}
