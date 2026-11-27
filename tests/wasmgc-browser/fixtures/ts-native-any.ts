// @native-only: engine dyn cannot construct a Uint8Array through a TS any constructor (bytes.constructor)
// Same source in default and opt-in native-any lanes. Owned records and
// arrays retain identities; host values and callbacks keep their contracts.
const page: any = globalThis;
const rows: any[] = [{id:0,value:3,n:0},{id:1,value:4,n:0}];
const state: any = {rows};
console.log(state.rows.find((row: any) => row.id === 1).value);
const same: any = state.rows[0]; state.rows[0].value = 8;
console.log(same === state.rows[0], same.value);
let calls = 0;
const mapped: any = state.rows.map((row: any, index: number) => { calls++; return row.value + index; });
console.log(mapped.join(','), calls);
page.auditKeep(state);
page.auditMutate(state.rows[0]);
console.log(page.auditKept() === state, state.rows[0].n);
const foreign: any = page.auditMake(); foreign.n = 12;
console.log(page.auditMadeN(), foreign === page.auditIdentity(foreign));
const ctor: any = Uint8Array; const view: any = new Uint8Array(2);
console.log(view instanceof ctor, view instanceof ArrayBuffer, view[3] === undefined);
