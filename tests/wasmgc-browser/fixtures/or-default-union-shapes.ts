// `||` defaults over unions: records, classes, functions, numbers and strings; the default is lazy.
class Box { v: number; constructor(v: number) { this.v = v; } }
type Opt = { name: string } | undefined;
let calls = 0;
const dflt = (): { name: string } => { calls++; return { name: "def" }; };
const o = (x: Opt): string => (x || dflt()).name;
const b = (x: Box | null): number => (x || new Box(9)).v;
type Run = ((n: number) => number) | undefined;
const r = (f: Run): number => (f || ((n: number) => n * 10))(2);
const s = (x: string | null | undefined): string => x || "empty";
const n = (x: number | null): number => x || -1;
console.log(o({ name: "a" }), o(undefined), calls, b(new Box(1)), b(null), r((n) => n + 1), r(undefined), s(""), s(null), s("z"), n(0), n(NaN), n(4));
