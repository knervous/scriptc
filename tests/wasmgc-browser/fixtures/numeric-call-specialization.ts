// Direct calls with known numbers/booleans, or an omitted constant default, call a scalar variant
// (ir/numeric-call-specialization.ts). Every form must still see JavaScript's values and defaults.
function scale(value: number, by: number = 2): number { return value * by; }
function flag(on: boolean = true): string { return on ? "on" : "off"; }
function depth(node: number, level: number = 0): number {
  // Recursion that omits the argument and passes it.
  if (node <= 1) return level;
  return node % 2 === 0 ? depth(node / 2, level + 1) : depth(node - 1);
}
let counter = 0;
function next(): number { counter++; return counter * 10; }
function sideEffect(base: number, step: number = next()): number { return base + step; }
function optional(value: number, extra?: number): string { return extra === undefined ? `${value}` : `${value}+${extra}`; }
function signed(value: number = 5): string { return Object.is(value, -0) ? "-0" : String(value); }
function kind(value?: number): string { return `${typeof value}:${String(value)}`; }
function rewrite(value?: number): number { if (value === undefined) value = 7; return value * 2; }
function maybe(on?: boolean): string { return on === undefined ? "unset" : on ? "yes" : "no"; }

const values = [1, 2.5, -3, 0, -0, NaN, Infinity];
for (const v of values) {
  console.log("scale", scale(v), scale(v, undefined), scale(v, 3), scale(v, NaN), scale(v, -0));
  console.log("choose", scale(v, v > 1 ? 3 : undefined), flag(v > 0 ? false : undefined), signed(v < 0 ? -0 : v), signed(v));
  console.log("kind", kind(v), kind(), kind(undefined), optional(v, v), rewrite(v), rewrite());
}
console.log("flag", flag(), flag(undefined), flag(false), flag(true), maybe(), maybe(true), maybe(false));
console.log("depth", depth(1), depth(12), depth(12, 5), depth(7));
console.log("side", sideEffect(1), sideEffect(1, 4), sideEffect(2), counter);
console.log("optional", optional(1), optional(2, 3), optional(4, undefined), optional(-0, -0), optional(NaN, NaN));
console.log("signed", signed(), signed(-0), signed(0), signed(undefined), signed(-1.5), signed(NaN));

// A number that is really undefined at run time (an out-of-range read the checker calls `number`).
const short: number[] = [1];
const past = short[3];
console.log("past", scale(2, past), kind(past), signed(past), optional(1, past), rewrite(past));

// The function as a value keeps its defaults; the variant is called directly beside it.
const viaValue: (value: number, by?: number) => number = scale;
console.log("value", viaValue(4), viaValue(4, 5), viaValue(4, undefined), scale(4));
const table = [scale, scale];
let sum = 0;
for (const f of table) sum += f(3);
const closure = (x: number) => scale(x) + scale(x, 10);
console.log("table", sum, closure(2), [1, 2, 3].map((x) => scale(x)).join(","));
