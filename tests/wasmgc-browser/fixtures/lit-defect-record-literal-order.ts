// Known defect: an object literal typed Record<LiteralUnion, T> enumerates its keys (Object.keys,
// JSON.stringify, for-in) in a canonical sorted order instead of the literal's written order.
// @known-defect(engine,native,native-any): a Record<union, T> object literal enumerates keys in canonical order, not written order
// @known-defect-expect: stdout: gem,ore,stone,wood
type Res = "wood" | "stone" | "ore" | "gem";
const stock: Record<Res, number> = { wood: 10, stone: 0, ore: 3, gem: 1 };
console.log(Object.keys(stock).join(","), JSON.stringify(stock));
