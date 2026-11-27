import { bTable } from "./b.ts";
export const aName = "a";
export function aHoisted(): string { return "hoisted-a"; }
export function aReadName(): string { return aName; }
export const aSeen = bTable.join(",");
console.log("a body", aSeen);
