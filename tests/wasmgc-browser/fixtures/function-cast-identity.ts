// @known-defect(engine): engine dyn has no identity root for a signature adapter: a cast makes a different function
// @known-defect-expect: stdout: typed false true false
// A function keeps its identity through a cast to another function type: the adapter the cast makes is the function it adapts
// (IR `adapts`). React's hooks hand a setter typed for the caller's action out of an erased dispatcher, and memo, effect deps and
// useCallback deps compare it with the previous render's by identity.
interface Action { kind: string; id: number }
type Dispatch<A> = (a: A) => void;
let calls = 0;
const erased: (a: unknown) => void = (_a: unknown) => { calls++; };
const slot: [number, (a: unknown) => void] = [0, erased];
function fromTuple<A>(): [number, Dispatch<A>] { return slot as unknown as [number, Dispatch<A>]; }
function cast<A>(): Dispatch<A> { return erased as Dispatch<A>; }

const a = cast<Action>(), b = cast<Action>();
console.log("typed", a === b, a !== b, Object.is(a, b));
const [, t1] = fromTuple<Action>();
const [, t2] = fromTuple<Action>();
console.log("tuple", t1 === t2);
const ua: unknown = a, ub: unknown = b;
console.log("unknown", ua === ub, ua === (erased as unknown));
const p1: Record<string, unknown> = { dispatch: a }, p2: Record<string, unknown> = { dispatch: b };
console.log("props", Object.is(p1.dispatch, p2.dispatch));
const deps1: unknown[] = [a], deps2: unknown[] = [b];
const viewed = erased as unknown as Dispatch<Action>;
console.log("deps", deps1[0] === deps2[0], deps1.indexOf(b), [a, b].includes(viewed), [a, b].indexOf(viewed));
const back = ua as (x: unknown) => void;
console.log("back", back === erased);
a({ kind: "x", id: 1 });
b({ kind: "y", id: 2 });
console.log("calls", calls);
const inc = (x: number): number => x + 1;
const w1 = inc as (x: number) => unknown, w2 = inc as (x: number) => unknown;
console.log("result", w1 === w2, w1(1), (w1 as unknown) === (inc as unknown));
const set = new Set<unknown>();
set.add(a);
console.log("set", set.has(b), set.has(erased));
