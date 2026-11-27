// A three-module import cycle (a -> b -> c -> a): c's top level calls a hoisted function of a (works), reads a's const through a
// function (TDZ ReferenceError) and b's const directly (TDZ ReferenceError); after initialization everything reads normally.
import { aName, aSeen, aReadName } from "./cycle-init3-lib/a.ts";
import { cRead } from "./cycle-init3-lib/c.ts";
console.log(aName, aSeen, aReadName(), cRead());
