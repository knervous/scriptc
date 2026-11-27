function Hash() { this.__data__ = {}; this.size = 0; }
Hash.prototype.has = function (key) { return this.__data__[key] !== undefined; };
Hash.prototype.set = function (key, v) { this.size += this.has(key) ? 0 : 1; this.__data__[key] = v; return this; };
Hash.prototype.delete = function (key) { var result = this.has(key) && delete this.__data__[key]; this.size -= result ? 1 : 0; return result; };
var probe = Function("return this");
export function run() {
  var h = new Hash(); h.set("a", 1).set("b", 2);
  var boxed = probe.call(5);
  return [h.delete("a"), h.delete("zz"), h.size, typeof boxed, boxed + 1, probe() === globalThis].join(",");
}
