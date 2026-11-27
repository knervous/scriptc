// Object.freeze of typed values that are not fresh literals: an interface-typed record, a union of record arms, a
// freeze inside a callback, and an array of records. Each is frozen afterwards (writes fail, isFrozen answers true).
"use strict";
interface Scalar { readonly kind: "scalar"; id: number; name: string }
interface Nested { readonly kind: "struct"; id: number; inner: Scalar }
type Field = Scalar | Nested;
function scalar(id: number): Scalar { return { kind: "scalar", id, name: `s${id}` }; }
const tryWrite = (f: () => void): string => { try { f(); return "wrote"; } catch (e) { return (e as Error).name; } };
const a: Scalar = scalar(1);
const fa = Object.freeze(a);
console.log("interface", Object.isFrozen(fa), fa === a, tryWrite(() => { a.id = 9; }), a.id);
const fields: Field[] = [scalar(2), { kind: "struct", id: 3, inner: scalar(4) }];
const frozen = fields.map((field) => Object.freeze(field));
console.log("union", frozen.every((f) => Object.isFrozen(f)), tryWrite(() => { fields[1]!.id = 7; }), fields[1]!.id);
const one: Field = fields[0]!;
Object.freeze(one);
console.log("union one", Object.isFrozen(one));
const list = Object.freeze(fields.slice());
console.log("array", Object.isFrozen(list), list.length);
const mutable: Field[] = fields.slice();
Object.freeze(mutable);
const message = (f: () => void): string => { try { f(); return "wrote"; } catch (e) { return (e as Error).message; } };
console.log("frozen push", message(() => { mutable.push(scalar(6)); }));
console.log("frozen set", message(() => { mutable[0] = scalar(7); }), mutable[0]!.id);
console.log("frozen length", message(() => { mutable.length = 0; }), mutable.length);
console.log("frozen pop", tryWrite(() => { mutable.pop(); }), mutable.length);
const numbers = [1, 2, 3];
Object.freeze(numbers);
console.log("numbers", Object.isFrozen(numbers), tryWrite(() => { numbers.reverse(); }), numbers.join(","));
const KEYS = Object.freeze(["ac", "damage"] as const);
console.log("const tuple", Object.isFrozen(KEYS), KEYS.length, KEYS[1]);
function pair(): [number, string] { return [1, "a"]; }
const tuple = pair();
Object.freeze(tuple);
console.log("tuple", Object.isFrozen(tuple), Object.isFrozen(pair()), tryWrite(() => { tuple[0] = 2; }), tuple[0]);
