// @native-any-only: array callbacks over TS any arrays walk directly only in this lane
// A function literal written at the call site is called directly by the
// walk (no closure code reference): capturing and non-capturing literals,
// index and array arguments, mutation during the walk, holes, early exits,
// and a callback held in a variable (the walk through its closure).
// @hits(native-any): ^\$arr\.find\.fn\.
// @hits(native-any): ^\$arr\.findIndex\.fn\.
// @hits(native-any): ^\$arr\.filter\.fn\.
// @hits(native-any): ^\$arr\.map\.fn\.
// @hits(native-any): ^\$arr\.forEach\.fn\.
// @hits(native-any): ^\$arr\.some\.fn\.
// @hits(native-any): ^\$arr\.every\.fn\.
// @hits(native-any): ^\$arr\.find\.direct\.
import { withThis } from "./hot-literal-callbacks-helper.js";
const rows: any[] = [{ id: 0, v: 3 }, { id: 1, v: 0 }, { id: 2, v: 5 }];
const state: any = { rows };
for (const id of [0, 2, 7]) console.log(id, JSON.stringify(state.rows.find((r) => r.id === id)), state.rows.findIndex((r) => r.id === id));
console.log(state.rows.find((r) => r.v === 0).id, state.rows.filter((r) => r.v > 1).length, state.rows.some((r) => r.v === 5), state.rows.every((r) => r.id < 3));
console.log(state.rows.map((r, i, a) => r.v * 10 + i + a.length).join(","));
let seen = "";
state.rows.forEach((r, i) => { seen += r.id + ":" + i + ";"; });
console.log(seen);
const held = (r: any) => r.v === 5;
console.log(state.rows.find(held).id);
const grow: any = [1, 2];
console.log(grow.find((x, _i, a) => { a.push(x + 10); return x > 5; }), grow.length);
const shrink: any = [1, 2, 3, 4];
console.log(shrink.find((x, _i, a) => { a.pop(); return x === 4; }), shrink.length);
let calls = 0;
console.log(state.rows.find((r) => { calls++; return r.v; }).id, calls);
const ids: any[] = [];
for (let k = 0; k < 3; k++) ids.push(state.rows.find((r) => r.id === k).v);
console.log(ids.join(","), withThis(state.rows));
