// Computed-key access on subclass instances held untyped: a subclass's per-class helper answers its own names and hands
// inherited plain fields to its base's helper. Each read, write and `in` below must answer as the subclass's own arms would:
// inherited fields three levels deep, a field the subclass redeclares, a getter over inherited fields, and
// keys no class declares (the fallback after every arm).
class Base { id = 1; label = "base"; count = 0; }
class Mid extends Base { label = "mid"; depth = 2; }
class Leaf extends Mid { leafOnly = true; count = 7; get total(): number { return this.count + this.id; } }
class Other extends Base { extra = "x"; }
const values: any[] = [new Base(), new Mid(), new Leaf(), new Other()];
const keys = ["id", "label", "count", "depth", "leafOnly", "total", "extra", "missing"];
for (const v of values) {
  console.log(keys.map((k) => `${k}=${v[k]}:${k in v}`).join(" "));
  // Writes keep each field's declared type (a typed field refuses another type: the compiled TypeError).
  for (const k of ["id", "depth", "count"]) if (k in v) v[k] = 40 + k.length;
  if ("extra" in v) v["extra"] = "y";
  console.log(keys.map((k) => `${k}=${v[k]}`).join(" "));
}
