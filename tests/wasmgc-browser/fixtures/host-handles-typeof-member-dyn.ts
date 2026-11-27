// @options: {"hostHandles": true}
// typeof tests over a dyn member read (React DOM's isEventSupported): a page receiver asks the host
// (js.typeof.member), a compiled receiver keeps its own read, a nullish receiver throws TypeError.
function probe(o: any, k: string) {
  return [
    "function" === typeof o.oninput, typeof o.onclick === "function", typeof o.nope, typeof o.length,
    typeof o.missing === "undefined", typeof o.value === "string", typeof o.ob === "object", typeof o.n === "number", typeof o.b === "boolean",
    typeof o[k],
  ].join(",");
}
const g = globalThis as any;
console.log(probe(g.console, "log"));
console.log(probe(g.document ? g.document : { oninput() {}, value: "x", ob: null, n: 1, b: true }, "n"));
console.log(probe({ oninput() {}, onclick: () => 1, value: "x", ob: {}, n: 1, b: true }, "n"));
console.log(probe([1, 2], "length"));
console.log(probe("str", "length"));
class Widget { get oninput() { return () => 1; } get n() { return "s"; } }
class Plain { value = 3; onclick() { return 1; } }
console.log(probe(new Widget(), "oninput"));
console.log(probe(new Plain(), "value"));
let calls = 0;
const withGetter = { get n() { calls++; return 5; } } as any;
probe(withGetter, "n");
console.log(calls);
for (const bad of [undefined, null]) {
  try { console.log(probe(bad, "x")); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
}
