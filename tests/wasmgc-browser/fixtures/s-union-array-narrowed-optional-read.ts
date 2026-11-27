// An optional element read on a union the checker narrowed to the array (`typeof names === "function"` took the other arm): the read goes through the array arm.
// (the instance-arena name-source shape: `typeof names === "function" ? names(i) : names?.[i]`)
type NameSource = readonly string[] | ((index: number) => string | undefined);
function label(names: NameSource | undefined, i: number): string {
  const name = typeof names === "function" ? names(i) : names?.[i];
  return name ?? "none";
}
console.log(label(["a", "b"], 1), label((i) => "f" + i, 2), label(undefined, 0), label(["a"], 5));
