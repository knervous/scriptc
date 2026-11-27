import { probe, viaAlias, add, drop, listing, mapProbe, each, identity, clearAll } from "./js-module-collection-var-helper.js";
console.log(probe());
console.log(add("c"), drop("a"), listing());
console.log(mapProbe());
console.log(each());
console.log(identity(), viaAlias("q"));
console.log(probe(), listing());
console.log(clearAll(), probe());
