// Known defect: a Partial<Record<LiteralUnion, T>> started empty and filled through a computed
// literal key enumerates its keys in the union's declaration (canonical) order instead of insertion
// order, so JSON.stringify and Object.keys differ from JavaScript.
// @known-defect(engine,native,native-any): Partial<Record<union, T>> filled by computed keys enumerates in canonical, not insertion, order
// @known-defect-expect: stdout: {"a":1,"b":1,"c":1}
type Mode = "a" | "b" | "c";
const order: Mode[] = ["c", "a", "b"];
const counts: Partial<Record<Mode, number>> = {};
for (const m of order) counts[m] = (counts[m] ?? 0) + 1;
console.log(JSON.stringify(counts), Object.keys(counts).join(","));
