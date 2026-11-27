// @options: {"interfaceClassArms": true}
// `"k" in x` where x is a runtime-optional local the checker narrowed (`x && !("k" in x)`): the
// receiver is the narrowed arm, and the test reads the held record's presence.
type Name = "a" | "b" | "c";
type Binds = Record<Name, string>;
type Stored = { binds?: Partial<Binds>; layout?: "x" | "y" };
function f(data: Stored | null): string {
  const stored: Stored = data ?? {};
  const saved: Partial<Binds> | undefined = stored.binds;
  if (stored.layout) {
    const merged = { a: "1", b: "2", c: "3", ...saved };
    if (stored.layout === "x" && saved && !("b" in saved) && saved.a === "x") { merged.c = "moved"; }
    return merged.a + merged.b + merged.c;
  }
  return saved ? ("b" in saved ? "has-b" : "none") : "undef";
}
console.log(f({ binds: { a: "x" }, layout: "x" }), f({ binds: { a: "x", b: "y" }, layout: "x" }), f(null), f({ layout: "y" }));
console.log(f({ binds: { a: "q" }, layout: "y" }), f({ binds: { b: "q" }, layout: "y" }), f({ binds: { a: "x" }, layout: "y" }));
console.log(f({ binds: { b: "q" } }), f({ binds: { a: "1" } }), f({}));
