// new Map(iterable) / new Set(iterable) on untyped sources (dyn.newCollection), from JavaScript (lib/collections.js).
import { build, refuse } from "./lib/collections.js";
console.log(build([["a", 1], ["b", 2], ["a", 5]], [1, 2, 2, 3]));
console.log(refuse([1]), refuse([["k", "v"], [{ 0: "x", 1: "y" }]].flat(0)));
