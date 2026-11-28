import { counter, label, twice } from "smoke-cjs";
console.log(twice(21), label(4));
// A compiled-in package's value the program types `any`: a compiled value by default, a page value with --no-native-any.
const c: any = counter(1);
c.bump().bump();
c.extra = "x";
console.log(c.n, c.extra, Object.keys(c).join(","));
