// After upstream 8e63080b60 (its corpus inexact-predicate-else-shared-read, first shape): the else branch of an
// inexact type predicate still receives the arm the predicate named, so a field every arm declares reads over the
// stored union; the retag to the checker's narrowed union trapped. (Upstream's second shape, a stored arm that
// declares the field beside a site arm that does not, is not taken here, and neither are class arms: they still trap.)
// An inexact type predicate: `isSpecial` returns false for an `A` whose `x`
// is small, so the else branch of `if (isSpecial(v))` can still receive an
// `A`. The checker narrows that branch to `B | C`; reading `kind` there, a
// field every arm declares, must read the stored value's field rather than
// narrow the value past the `A` arm the negation stranded.
type A = { kind: "a"; x: number };
type B = { kind: "b"; y: number };
type C = { kind: "c"; z: number };
type Kind = A | B | C;

function isSpecial(v: Kind): v is A {
  return v.kind === "a" && v.x > 100;
}

function describeKind(v: Kind): string {
  if (isSpecial(v)) return `special ${v.x}`;
  return v.kind;
}

const values: Kind[] = [
  { kind: "a", x: 1 },
  { kind: "a", x: 200 },
  { kind: "b", y: 2 },
  { kind: "c", z: 3 },
];
for (const value of values) console.log(describeKind(value));


export {};
