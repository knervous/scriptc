// Object and array literals passed straight to a page function arrive as plain page objects (prototype, keys,
// nesting, identity and mutation as the page sees them); a compiled callee gets the same values.
const page: any = globalThis;
const tag = "x", n = 3;
console.log(page.auditLiteral({ a: 1, b: "two", c: true, d: null }));
console.log(page.auditLiteral({ nested: { deep: { k: n } }, list: [1, "s", { z: 0 }] }, [n, [n + 1], { x: tag }]));
console.log(page.auditLiteral({ 2: "b", a: 1, 1: "a" }));
const el = page.auditElement("div", { className: tag, style: { color: "red" } }, ["a", "b"]);
console.log(el.type, el.props.className, el.props.style.color, el.children.length, el.props === page.auditKept());
const props = page.auditKept();
page.auditMutate(props);
console.log(page.auditKeys(props), props.n, page.auditKeys(el.props));
console.log(page.auditInvoke({ label: "hi", onClick: (s: string) => s.toUpperCase() }));
console.log(page.auditCallWith((o: any, a: any) => o.m + a.length, null, { m: 1 }, [2, 3]));
let order = "";
const step = (s: string) => { order += s; return s; };
console.log(page.auditLiteral({ first: step("1"), second: [step("2"), step("3")], third: { v: step("4") } }), order);
// A compiled callee receives the literal as a compiled value, as before.
const local: any = (o: any) => Object.keys(o).join(",") + ":" + o.p.q + ":" + o.arr[1];
console.log(local({ p: { q: 5 }, arr: [7, 8] }));
const picked: any = [page.auditKeys, local][n - 2];
console.log(picked({ p: { q: 6 }, arr: [9, 10] }));
page.auditKeep({ shared: 1 });
const back = page.auditKept();
back.shared = 2;
console.log(page.auditKept().shared, page.auditKeys(back));
