// A keyed read of a record bound to a const and presence-tested at once (`const entry = TABLE[k]; return entry ? ...`,
// `if (entry === undefined) ...`, `if (entry) ...`) holds undefined for an absent key, as `if (!entry)` already did:
// the client's appearanceForMaterial threw "the record has no key" for an undeclared material.
interface Look { readonly kind: string; readonly cut: string }
interface Request extends Look { readonly declared: boolean }
const TABLE: Readonly<Record<number, Omit<Request, "declared">>> = { 1: { kind: "cloth", cut: "fitted" } };
function lookFor(n: number): Request {
  const entry = TABLE[n];
  return entry ? { ...entry, declared: true } : { kind: "none", cut: "-", declared: false };
}
function viaUndefined(n: number): string {
  const entry = TABLE[n];
  if (entry === undefined) return "absent";
  return entry.kind;
}
function viaIf(n: number): string {
  const entry = TABLE[n];
  if (entry) return "has " + entry.cut;
  return "no";
}
const a = lookFor(1), b = lookFor(25);
console.log(a.kind, a.cut, a.declared, b.kind, b.declared);
console.log(viaUndefined(1), viaUndefined(7), viaIf(1), viaIf(9));
const HANDS: Readonly<Record<string, "left" | "right">> = { swing1: "right" };
function handFor(name: string, armed: boolean): string {
  const hand = HANDS[name];
  if (hand && armed) return hand;
  return "none";
}
console.log(handFor("swing1", true), handFor("w01", true), handFor("swing1", false));
