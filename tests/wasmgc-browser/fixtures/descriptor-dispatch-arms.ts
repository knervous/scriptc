// @native-only: the engine lane cannot marshal a class value to JavaScript (a class's `constructor` read through dyn), before and after this dispatch
// Dynamic access dispatched by type index (docs-draft/DESCRIPTOR_DISPATCH.md): a record's shape and a class instance's class
// select their arm through a table. Each value below must answer as it would through the type-test chains: a subclass instance
// takes its own class's members (the chain's exact-class arms), a sibling class and a record shape that never meet are kept
// apart, and a key no type declares falls through to the inherited member.
class Base { kind = "base"; size = 1; describe(): string { return `${this.kind}:${this.size}`; } }
class Sub extends Base { kind = "sub"; extra = 7; }
class Leaf extends Sub { kind = "leaf"; depth = 3; }
class Other { kind = "other"; size = 99; }
interface Point { x: number; y: number }
interface Named { name: string; tags: string[] }
interface Wide { a: number; b: number; c: number; d: number; e: number; f: number }

const values: unknown[] = [new Base(), new Sub(), new Leaf(), new Other(),
  { x: 1, y: 2 } as Point, { name: "n", tags: ["t"] } as Named, { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } as Wide];
const keys = ["kind", "size", "extra", "depth", "x", "y", "name", "f", "missing", "toString"];

for (const value of values) {
  const v: any = value;
  const read = keys.map((k) => { const got = v[k]; return typeof got === "function" ? "fn" : String(got); }).join(",");
  const has = keys.map((k) => (k in v ? 1 : 0)).join("");
  const own = keys.map((k) => (Object.prototype.hasOwnProperty.call(v, k) ? 1 : 0)).join("");
  console.log(`${read} | in ${has} | own ${own} | keys ${Object.keys(v).join(",")}`);
}

// Writes through dyn land in the right type's field.
for (const value of values) {
  const v: any = value;
  for (const k of ["size", "x", "f"]) if (k in v) v[k] = 40;
  console.log(JSON.stringify(v));
}

// A spread and an assign copy each shape's own fields.
const copied: any = { ...(values[4] as any), ...(values[6] as any) };
console.log(Object.keys(copied).join(","), copied.x, copied.f);
