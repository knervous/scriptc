// @expect: pending 1 captured 2 null 0 undefined -1
// @expect: subclass 2
// @expect: loop 3000
// A value from untyped code checked into a union of classes: each class arm is a reference
// test, so a value of a later arm reaches it without the earlier arms' checks throwing and catching a TypeError.
class PendingPipeline { tag(): number { return 1; } }
class CapturedPipeline { tag(): number { return 2; } }
class TracedCaptured extends CapturedPipeline { }
type Pipeline = PendingPipeline | CapturedPipeline | null | undefined;

function pick(value: any): Pipeline { return value; }
function tagOf(p: Pipeline): number { return p === null ? 0 : p === undefined ? -1 : p.tag(); }

const cache: Record<string, any> = { a: new PendingPipeline(), b: new CapturedPipeline(), c: null, d: undefined };
console.log("pending", tagOf(pick(cache.a)), "captured", tagOf(pick(cache.b)), "null", tagOf(pick(cache.c)), "undefined", tagOf(pick(cache.d)));

console.log("subclass", tagOf(pick(new TracedCaptured() as any)));

let sum = 0;
const values: any[] = [new CapturedPipeline(), new PendingPipeline(), new CapturedPipeline()];
for (let i = 0; i < 600; i++) for (const v of values) sum += tagOf(pick(v));
console.log("loop", sum);

