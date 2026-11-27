// A func-typed slot can hold undefined at run time (an unassigned `var`
// with a definite-assignment assertion): array callbacks must throw V8's
// TypeError, catchable, instead of trapping in the direct loop's cast.
// @native-only: the engine lane hands the undefined closure to a host WeakMap ("Invalid value used as weak map key", pre-existing)
const tryIt = (label: string, f: () => any) => { try { console.log(label, String(f())); } catch (e) { console.log(label, "throw", (e as Error).name, (e as Error).message); } };
const mk = (): any => [1, 2, 3, 4];
var late!: (x: any) => boolean;
tryIt("find", () => mk().find(late));
tryIt("findIndex", () => mk().findIndex(late));
tryIt("filter", () => mk().filter(late));
tryIt("some", () => mk().some(late));
tryIt("every", () => mk().every(late));
tryIt("map", () => mk().map(late));
tryIt("forEach", () => mk().forEach(late));
function holder(): (x: any) => boolean { return late; }
tryIt("returned", () => mk().filter(holder()));
late = (x: any) => x > 2;
tryIt("assigned", () => mk().filter(late).join());
console.log("end");
