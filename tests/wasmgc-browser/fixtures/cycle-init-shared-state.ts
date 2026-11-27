// A cycle entered through b: a runs first, calls a hoisted function of b (works) and records through it; b's body then writes
// to a's initialized objects and reads them back. Same output as Node.
import { registry } from "./cycle-shared-lib/b.ts";
import { describe, shared } from "./cycle-shared-lib/a.ts";
console.log(describe(), shared.hits, registry.join(","));
