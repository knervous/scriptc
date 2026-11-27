// Array literals with spread elements handed to untyped JavaScript callbacks.
import { applyTo } from './r4-typed-helper.js';
const picked: string[] = ["a"];
const seen = new Set<string>(["s", "t"]);
const r1: string = applyTo((v: any) => JSON.stringify(v), [...picked, "b"]);
const r2: string = applyTo((v: any) => JSON.stringify(v), ["x", ...seen, ...picked, "y"]);
const set = (next: string[]) => next.join("+");
const r3: string = set([...picked, ...picked, "z"]);
console.log(r1 + " " + r2 + " " + r3);
const m = new Map<string, number>([["k", 1]]);
console.log(applyTo((v: any) => JSON.stringify(v), [..."hé", ...m, ...new Uint8Array([7, 8])]));
