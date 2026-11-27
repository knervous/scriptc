// A two-module import cycle whose top levels run code across the cycle: a call into an already-initialized module works, a
// let/const read before its declaration ran throws Node's ReferenceError, a var reads undefined, a function declaration is
// callable at link time. Same output as Node.
import { aDerived, aReadBase, aReadCount, aCount, aBump } from "./cycle-init2-lib/a.ts";
console.log("main", aDerived, aReadBase(), aReadCount(), aCount);
aBump();
console.log("bumped", aCount, aReadCount());
