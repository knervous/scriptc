// __proto__ on untyped values sets and reads the prototype (JS helper), and
// a TS literal with a __proto__ key handed to the page keeps that meaning.
import { run } from "./dyn-proto-accessor-helper.js";
console.log(run());
const tp: any = JSON.parse('{"x":1}'), tq: any = JSON.parse('{"y":2}');
tp.__proto__ = tq;
console.log(tp.y, tp.__proto__ === tq, tp.hasOwnProperty("__proto__"));
const p: any = JSON.parse('{"y":2}');
const o: any = { __proto__: p, a: 1 };
console.log(o.y, Object.getPrototypeOf(o) === p, o.hasOwnProperty("__proto__"));
const n: any = { __proto__: null, b: 1 };
console.log(Object.getPrototypeOf(n) === null, n.b);
