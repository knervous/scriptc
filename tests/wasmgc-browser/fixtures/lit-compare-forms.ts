// Every comparison form on literal-union values: ===, !==, ==, !=, Object.is, <, >, between two
// values of the same union, between two different unions that overlap, against a non-member
// literal, against a plain `string` variable, against `any`, and through includes/indexOf.
type A = "red" | "green" | "blue";
type B = "blue" | "black";

const as: A[] = ["red", "green", "blue"];
const bs: B[] = ["blue", "black"];
const plain: string[] = ["red", "blue", "", "Red", "black"];
const loose: any[] = ["green", 1, null, undefined, "blue"];

for (const a of as) {
  const row: (string | number | boolean)[] = [a];
  row.push(a === "red", a !== "red", a == "green", a != "green", Object.is(a, "blue"));
  for (const b of bs) row.push(a === b, a !== b, Object.is(a, b));
  for (const p of plain) row.push(a === p ? 1 : 0);
  for (const l of loose) row.push(a === l ? "s" : "-", a !== l ? "n" : "e");
  row.push((a as string) === "purple", a < "green", a > "blue", a <= "red");
  console.log(row.join(" "));
}

// Same-union pairs.
let same = 0, diff = 0;
for (const x of as) for (const y of as) { if (x === y) same++; if (x !== y) diff++; if (x == y && !Object.is(x, y)) console.log("bad"); }
console.log(same, diff);

// Runtime-built equal strings are equal to the literal in every form.
const built = "gr" + "een";
const g: A = built as A;
const lit: A = "green";
console.log(g === lit, g == lit, Object.is(g, lit), g !== lit, ([lit] as A[]).includes(g), [g].indexOf(lit), g === "green", "green" === g);

// Comparisons whose result is stored, negated, and used in arithmetic.
let score = 0;
for (let i = 0; i < 30; i++) {
  const a = as[i % 3];
  const b = bs[i % 2];
  score += (a === b ? 100 : 0) + (a !== "blue" ? 1 : 0) + (!(a === "red") ? 10 : 0);
}
console.log(score);

// A literal compared with a value read through an index signature and through a getter.
const dict: { [k: string]: string } = { x: "blue", y: "red" };
class Get { get c(): A { return as[1]; } }
const getter = new Get();
console.log(dict.x === "blue", dict["y"] === as[0], getter.c === "green", getter.c !== dict.x, Object.is(getter.c, built));

// Boolean results from literal comparisons stored in an array and joined.
console.log(as.map((a) => [a === "green", a == "blue", a !== "red"].map((b) => (b ? 1 : 0)).join("")).join(" "));
