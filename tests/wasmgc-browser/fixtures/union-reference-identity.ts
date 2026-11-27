class A { v = 1; }
class B { w = 2; }
type R = { k: number };
type U = A | B | R | null;
const a = new A();
const b = new B();
const r: R = { k: 1 };
function same(x: U, y: U): boolean { return x === y; }
function diff(x: U, y: U): boolean { return x !== y; }
console.log(same(a, a), same(a, new A()), same(b, b), same(r, r), same(r, { k: 1 }));
console.log(same(null, null), same(a, null), same(null, b), same(a, b));
console.log(diff(a, a), diff(a, null), diff(r, r), diff(null, null));
type V = A | number | string | undefined;
function same2(x: V, y: V): boolean { return x === y; }
console.log(same2(a, a), same2(1, 1), same2(1, 2), same2("a", "a"), same2("a", "b"), same2(undefined, undefined), same2(a, 1), same2(1, "1"));
class C { u = 3; }
class D extends C { z = 4; }
type L = A | B | null;
type M = B | C | null;
function cross(x: L, y: M): boolean { return x === y; }
const bb = new B();
const cc = new C();
console.log(cross(bb, bb), cross(null, null), cross(a, null), cross(null, cc), cross(bb, cc), cross(a, cc));
function crossNe(x: L, y: M): boolean { return x !== y; }
console.log(crossNe(bb, bb), crossNe(a, cc), crossNe(null, null));
type N = number | string | null;
type O = string | boolean | null;
function mixed(x: N, y: O): boolean { return x === y; }
console.log(mixed("a", "a"), mixed("a", "b"), mixed(1, null), mixed(null, null), mixed(null, false));
// A subclass instance compares through its base arm.
const dd: C = new D();
console.log(cross(null, dd), cross(bb, dd), dd === dd, (dd as D).z);
