// A pure export that reachable code reads later (through a function declared before it, a closure, and another pure binding) keeps its
// initialiser; an unread sibling is skipped without changing the output.
import { viaFunction, readLater } from "./pure-init-lib/reads.ts";
console.log(viaFunction(21));
console.log(readLater());
