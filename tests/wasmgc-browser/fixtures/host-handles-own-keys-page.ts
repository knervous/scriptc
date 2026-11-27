// @options: {"hostHandles": true}
// @native-any-only: Object.getOwnPropertyNames/getOwnPropertySymbols and Reflect.ownKeys lower only for TS any receivers
// Own keys of page values through the typed snapshot cursor: Object.keys, getOwnPropertyNames,
// getOwnPropertySymbols, Reflect.ownKeys on a page receiver, and on compiled receivers.
const g = globalThis as any;
const sym = g.Symbol.for("tag");
const page = new g.Object();
page.a = 1; page.b = 2; g.Object.defineProperty(page, sym, { value: 3, enumerable: true });
g.Object.defineProperty(page, "hidden", { value: 4, enumerable: false });
console.log(Object.keys(page).join(), Object.getOwnPropertyNames(page).join(), Object.getOwnPropertySymbols(page).length, Reflect.ownKeys(page).length);
console.log(Object.getOwnPropertySymbols(page)[0] === sym, Object.keys(new g.Date(0)).length, Object.getOwnPropertyNames(g.Math).length > 10);
console.log(Object.keys(g.Array.prototype).length, Object.getOwnPropertyNames("ab").join());
const own: any = { x: 1, y: 2 };
console.log(Object.keys(own).join(), Object.getOwnPropertyNames(own).join(), Object.getOwnPropertySymbols(own).length, Reflect.ownKeys(own).length);
const arr = new g.Array(3);
console.log(Object.keys(arr).length, Object.getOwnPropertyNames(arr).join());
try { Reflect.ownKeys(5 as any); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
