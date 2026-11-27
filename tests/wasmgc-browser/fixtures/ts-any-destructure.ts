// Object destructuring over TS `any` sources: plain, renamed, defaulted,
// nested, rest, getters, captured by closures, and nullish sources.
function pick(t0: any) { const { id, label: name = "none", deep: { n } = { n: -1 } } = t0; return `${id}:${name}:${n}`; }
console.log(pick({ id: 1, label: "a", deep: { n: 2 } }), pick({ id: 3 }), pick({ id: undefined, label: null }));
function rest(t0: any) { const { id, ...others } = t0; return id + "|" + others.b + others.c + ("id" in others); }
console.log(rest({ id: 5, b: 1, c: 2 }));
let reads = 0;
const withGetter: any = { get id() { reads++; return 9; } };
function viaGetter(t0: any) { const { id } = t0; return id; }
console.log(viaGetter(withGetter), reads);
function selector(t0) { const { id } = t0; return (item) => item.id === id; }
const rows: any[] = [{ id: 0 }, { id: 1 }, { id: 2 }];
console.log(rows.findIndex(selector({ id: 2 })), rows.findIndex(selector({ id: "2" })), rows.findIndex(selector({})));
function nullish(t0: any) { try { const { id } = t0; return id; } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; } }
console.log(nullish(null), nullish(undefined), nullish(0), nullish("str"));
function pair(t0: any) { const [a, b] = t0; return a + b; }
console.log(pair([2, 3]), pair("xy"));
