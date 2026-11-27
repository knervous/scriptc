const MESHES: Record<string, Record<string, string>> = { a: { x: "ax", y: "ay" } };
const PART: Record<string, Partial<Record<"x" | "y", string>>> = { a: { x: "px" } };
interface Item { name: string; n: number }
const ITEMS: Record<string, Item> = { i: { name: "I", n: 2 } };
const NEST: Record<string, { sub: Record<string, number> }> = { s: { sub: { k: 4 } } };
function roleMeshFor(uniform: string, piece: string): string | null { return MESHES[uniform]?.[piece] ?? null; }
console.log(roleMeshFor("a", "x"), roleMeshFor("a", "z"), roleMeshFor("q", "x"));
function part(u: string, p: "x" | "y"): string | undefined { return PART[u]?.[p]; }
console.log(part("a", "x"), part("a", "y"), part("b", "x"));
function nm(k: string): string | undefined { return ITEMS[k]?.name; }
console.log(nm("i"), nm("j"));
function deep2(k: string, j: string): number | undefined { return NEST[k]?.sub?.[j]; }
console.log(deep2("s", "k"), deep2("t", "k"));
