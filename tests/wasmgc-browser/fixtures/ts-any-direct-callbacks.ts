// Array callbacks over TS any arrays with statically known closures:
// arity, index/array arguments, this, holes, mutation during the walk,
// non-boolean predicates and early exits. Each kind must take its direct loop:
// @hits(native-any): ^\$arr\.find\.(direct|fn)\.
// @hits(native-any): ^\$arr\.findIndex\.(direct|fn)\.
// @hits(native-any): ^\$arr\.filter\.(direct|fn)\.
// @hits(native-any): ^\$arr\.map\.(direct|fn)\.
// @hits(native-any): ^\$arr\.forEach\.(direct|fn)\.
// @hits(native-any): ^\$arr\.some\.(direct|fn)\.
// @hits(native-any): ^\$arr\.every\.(direct|fn)\.
import { holes } from "./ts-any-direct-callbacks-helper.js";
const rows: any[] = [{ id: 0, v: 3 }, { id: 1, v: 0 }, { id: 2, v: 5 }];
const state: any = { rows };
const target = 2;
console.log(state.rows.find((r) => r.id === target).v, state.rows.findIndex((r) => r.v === 0), state.rows.find((r) => r.id === 9));
console.log(state.rows.filter((r) => r.v).length, state.rows.some((r) => r.v > 4), state.rows.every((r) => r.id < 3));
console.log(state.rows.map((r, i) => r.v * 10 + i).join(","), state.rows.map((_r, i, a) => a.length - i).join(","));
let seen = ""; state.rows.forEach((r, i) => { seen += r.id + ":" + i + ";"; }); console.log(seen);
const holey: any = holes();
console.log(holey.find((x) => x === undefined), holey.findIndex((x) => x === undefined), holey.filter((_x) => true).length, holey.map((x) => x * 2).length);
const growing: any = [1, 2];
console.log(growing.find((x, _i, a) => { a.push(x + 10); return false; }), growing.length);
const shrinking: any = [1, 2, 3, 4];
let visits = 0; shrinking.forEach((_x, _i, a) => { visits++; a.pop(); }); console.log(visits);
console.log(state.rows.find((r) => r.v && r.id), state.rows.filter((r) => r.id - 1).length, state.rows.find((_r) => "") === undefined);
console.log(state.rows.filter(function (r) { return r.v === 0; }).length);
