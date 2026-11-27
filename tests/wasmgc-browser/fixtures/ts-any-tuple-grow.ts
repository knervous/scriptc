// @native-any-only: a TS tuple held by reference in native dyn (TS any)
// @native-refuses: growing a typed tuple from untyped code is refused (typed code reads a tuple's length as its arity constant)
// @expect-native: of 1
// @expect-native: of 2
// @expect-native: true adding an element to a typed tuple from untyped code is not supported
// @expect-native: true adding an element to a typed tuple from untyped code is not supported
// @expect-native: 2 2 7 [7,2]
const t: [number, number] = [1, 2];
const a: any = t;
for (const x of a) console.log("of", x);
try { a.push(3); console.log("pushed", a.length); } catch (e: any) { console.log(e instanceof TypeError, e.message); }
try { a[2] = 3; console.log("set", a.length); } catch (e: any) { console.log(e instanceof TypeError, e.message); }
a[0] = 7;
console.log(t.length, a.length, t[0], JSON.stringify(a));
