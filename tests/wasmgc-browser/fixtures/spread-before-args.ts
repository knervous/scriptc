// @native-only: the engine lane has no runtime argument-pack spreads (dyn.packPushSpread / packPushSpreadIter), an existing engine gap
// A spread that is not the last argument, into a rest parameter (vector.ts Matrix.subtractFromFloats
// `this.subtractFromFloatsToRef(...floats, new Matrix())`): the spread's elements in order, then the rest.
class M {
  readonly tag: string;
  constructor(tag: string) { this.tag = tag; }
  sum(...args: Array<number | M>): string {
    const nums = args.filter((a): a is number => typeof a === "number");
    const last = args[args.length - 1];
    return `${args.length}:${nums.reduce((a, b) => a + b, 0)}:${last instanceof M ? last.tag : "-"}`;
  }
  fromFloats(...floats: number[]): string { return this.sum(...floats, new M("result")); }
}
const m = new M("m");
console.log(m.fromFloats(1, 2, 3), m.fromFloats());
function* gen(): Generator<number> { yield 10; yield 20; }
console.log(m.sum(...new Set([4, 5]), new M("set")), m.sum(...gen(), 1, new M("gen")), m.sum(...[7, 8], ...[9], new M("two")));
function chars(...xs: Array<string | number>): string { return xs.join("|"); }
console.log(chars(..."héy", 1), chars(...["a"], ..."bc", 2));
