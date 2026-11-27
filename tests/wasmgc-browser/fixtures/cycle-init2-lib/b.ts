import { aBase, aPure, aReadBase, aReadCount, aReadVar } from "./a.ts";
export const bValue = 5;
export function bHelper(n: number): number { return n * bValue; }
console.log("b hoisted call", aPure(1)); // a function declaration is initialized at link time
for (const [label, read] of [["const", aReadBase], ["let", aReadCount]] as const) {
  try {
    console.log(label, "ok", read());
  } catch (e) {
    console.log(label, (e as Error).name, (e as Error).message, e instanceof ReferenceError);
  }
}
console.log("var", aReadVar()); // a var reads undefined before its declaration ran
try {
  console.log("direct", aBase); // a direct read of an imported binding that has not run
} catch (e) {
  console.log("direct", (e as Error).name, (e as Error).message, e instanceof ReferenceError);
}
