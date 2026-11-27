// @native-any-only: the other lanes destructure TS any through the page-value path, whose message spells the caller's argument (pre-existing)
// Empty object patterns over TS `any` still require an object-coercible
// source, at the top and nested: `const {} = null` throws V8's TypeError;
// a primitive source does not throw.
const tryIt = (label: string, f: () => string, full = true) => { try { console.log(label, f()); } catch (e) { console.log(label, (e as Error).name, full ? (e as Error).message : ""); } };
function none(t0: any) { const {} = t0; return "ran"; }
function emptyNested(t0: any) { const { a: {} } = t0; return "ran"; }
function emptyDeep(t0: any) { const { a: { b: {} } } = t0; return "ran"; }
function mixed(t0: any) { const { id, a: {} } = t0; return String(id); }
for (const v of [null, undefined, 0, "s", {}]) tryIt("none", () => none(v));
for (const v of [{}, { a: null }, { a: 1 }, { a: {} }]) tryIt("emptyNested", () => emptyNested(v));
for (const v of [{ a: {} }, { a: { b: null } }, { a: { b: [] } }]) tryIt("emptyDeep", () => emptyDeep(v), false);
tryIt("mixed", () => mixed({ id: 1, a: 2 }));
tryIt("mixedNull", () => mixed({ id: 1, a: null }));
