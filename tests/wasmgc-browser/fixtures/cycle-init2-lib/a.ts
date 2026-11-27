import { bHelper, bValue } from "./b.ts";
export function aPure(n: number): number { return n + 1; }
export const aBase = 10;
export let aCount = 1;
export var aVar: number | undefined = 7;
export function aReadBase(): number { return aBase; }
export function aReadCount(): number { return aCount; }
export function aBump(): void { aCount += 1; } // live binding: importers see the update
export function aReadVar(): number | undefined { return aVar; }
export const aDerived = bHelper(2); // b initialized before a's body: the call works
console.log("a body", aDerived, bValue, aReadBase(), aReadVar());
