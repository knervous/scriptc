// A typed host module answered by the stub host (stub-host.c): numbers and strings across the island, and a host
// throw caught as the program's TypeError. The module's declaration is host-demo.d.ts.
/// <reference path="./host-demo.d.ts" />
import { add, fail, greet } from "host:demo";

console.log(add(2, 3));
console.log(greet("native"));
try {
  fail();
  console.log("not reached");
} catch (e) {
  console.log(e instanceof TypeError, (e as Error).message);
}
