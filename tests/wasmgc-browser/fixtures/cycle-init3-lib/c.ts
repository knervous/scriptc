import { aHoisted, aReadName } from "./a.ts";
import { bTable } from "./b.ts";
export const cLabel = "c1";
console.log("c hoisted", aHoisted());
try { console.log(aReadName()); } catch (e) { console.log((e as Error).name, (e as Error).message, e instanceof ReferenceError); }
try { console.log(bTable.length); } catch (e) { console.log((e as Error).name, (e as Error).message, e instanceof ReferenceError); }
export function cRead(): string { return cLabel + bTable.length; }
