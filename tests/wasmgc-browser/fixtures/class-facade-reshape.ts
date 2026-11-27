// @profile: a compiled class instance's page facade has a fixed shape: the page cannot add or delete its properties, freeze it, or store a value of another type in a typed field (each throws a TypeError naming the limitation)
// @expect: add TypeError Cannot add property extra of a compiled Box instance (its shape is fixed)
// @expect: type TypeError
// @expect: delete TypeError Cannot delete property n of a compiled Box instance (its shape is fixed)
// @expect: freeze error
// @expect: 1 2 n
const h: any = globalThis;
class Box { n = 1; get twice() { return this.n * 2; } }
const b: any = new Box();
try { h.Reflect.set(b, "extra", 1); console.log("added", b.extra); } catch (e) { console.log("add", (e as Error).name, (e as Error).message); }
try { b.n = "str"; console.log("stored", b.n); } catch (e) { console.log("type", (e as Error).name); }
try { h.auditDeleteKey(b, "n"); console.log("deleted", b.n); } catch (e) { console.log("delete", (e as Error).name, (e as Error).message); }
h.auditFreeze(b);
console.log(b.n, b.twice, h.auditKeys(b));
