// JSON.stringify of records whose optional fields are booleans, numbers and
// strings (boxed unions with an undefined arm): set fields print, unset ones
// are omitted, nested and in arrays.
type Part = { name: string; visible?: boolean; vertices?: number; tag?: string };
function make(n: number): Part {
  return n > 1 ? { name: "a", vertices: n, tag: "t" } : n > 0 ? { name: "b", visible: true } : { name: "c" };
}
const parts: Part[] = [make(2), make(1), make(0)];
console.log(JSON.stringify(parts[0]), JSON.stringify(parts[1]), JSON.stringify(parts[2]));
console.log(JSON.stringify({ parts, count: parts.length }));
console.log(JSON.stringify(parts, null, 1).length);
