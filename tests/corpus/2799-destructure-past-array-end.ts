// Array destructuring past the end binds undefined, also where the checker (no noUncheckedIndexedAccess) types the
// binding as the bare element: `const [width, format] = value.split(":")` with no ':' (the render seam's
// dataTextures), and pairs of a decoded tuple list destructured in a for-of.
function formatOf(value: string): string {
  const [width, format] = value.split(":");
  return format === "f16" ? `${width}/half` : `${width}/full`;
}
console.log(formatOf("64"), formatOf("64:f16"), formatOf(""));
const letters: string[] = ["x"];
const [a, b, c] = letters;
console.log(a, b === undefined, c === "z", typeof c);
const pairs: [string, string][] = [["FOG", ""], ["MODE", "splat:f16"]];
for (const [name, value] of pairs) {
  const [head, tail] = value.split(":");
  console.log(name, head === "" ? true : head, tail === "f16", tail ?? "none");
}
