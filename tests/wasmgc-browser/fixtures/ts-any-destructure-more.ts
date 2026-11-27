// Object destructuring of TS any, continued: a page object source with a
// default, parameter patterns, an array source, and a captured
// binding compared with === (NaN never matches, "1" is not 1).
const page: any = globalThis;
function fromPage() { const { n, missing = "d" } = page.auditMake(); return n + missing; }
console.log(fromPage());
function param({ id, label = "dflt" }: any) { return id + label; }
console.log(param({ id: 1 }), param({ id: 2, label: "x" }));
function fromArray(t0: any) { const { length, 0: first } = t0; return length + ":" + first; }
console.log(fromArray([7, 8]));
function selector(t0: any) { const { id } = t0; return (item: any) => item.id === id; }
const rows: any = [{ id: "1" }, { id: 1 }, { id: NaN }];
console.log(rows.findIndex(selector({ id: 1 })), rows.findIndex(selector({ id: NaN })), rows.findIndex(selector({ id: "1" })));
