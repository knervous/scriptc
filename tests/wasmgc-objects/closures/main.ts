import { mk, twice, LABEL } from "./lib";

const f = mk(3);
const g = (y: number) => f(y) + 1;
const doubled = twice([1, 2, 3]).map((x) => x + 1);
console.log(LABEL, g(2), doubled.join(","));
