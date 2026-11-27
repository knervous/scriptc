// A module-level `const f = (…) => …` called through its binding compiles to a direct call (agent RT, 10-28). The
// binding's temporal dead zone still holds: a function declaration hoisted above it and called early throws JS's
// ReferenceError, and the arguments are not evaluated first.
function early(): string {
  try {
    return String(helper(note("arg")));
  } catch (e) {
    return (e instanceof ReferenceError ? "ReferenceError" : "other") + " " + notes.join(",");
  }
}
const notes: string[] = [];
const note = (s: string): number => { notes.push(s); return 1; };
console.log("before", early());
const helper = (x: number): number => x * 2 + 1;
const named = function twice(x: number): number { return x * 2; };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
function sample(u: number): number { return clamp01(u) * 10 + helper(u) + named(u); }
console.log("after", early(), sample(0.25), sample(4), sample(-1));
let reassigned = (x: number) => x + 1;
console.log("let", reassigned(1));
reassigned = (x: number) => x + 100;
console.log("let again", reassigned(1));
const viaValue = [helper, clamp01].map((f) => f(0.5)).join(",");
console.log("as values", viaValue, helper === helper, typeof helper);
