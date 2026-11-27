// `o.name?.(...)` on a page value: the member is read once; a nullish member gives undefined and its
// arguments never run; a present one is called with `this` = o. (load-trace.ts closeSpan:
// `performance.measure?.(name, ...)`, `performance.clearMeasures?.(name)`.)
let evaluated = 0;
function arg(v: string): string { evaluated++; return v; }
type Optional = Performance & { definitelyAbsent?: (x: string) => string };
const perf = performance as Optional;
const mark = perf.mark?.(arg("m1"));
console.log(typeof mark, evaluated);
const absent = perf.definitelyAbsent?.(arg("never"));
console.log(absent === undefined, evaluated);
perf.clearMarks?.(arg("m1"));
console.log(evaluated, perf.getEntriesByName("m1").length);
