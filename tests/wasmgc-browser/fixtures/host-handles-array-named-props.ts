// @options: {"hostHandles": true}
// @native-any-only: match results carry index/input/groups only where untyped code receives them (TS any)
// A dyn array with own named properties (a regex match result): structuredClone copies them, the page sees
// them through the array's facade (get/has/ownKeys/descriptors/set/delete/define), Object.defineProperty
// and works exactly for plain data descriptors. (The d flag is refused at compile time.)
const h: any = globalThis;
const text: string = h.auditIdentity("ab 12-zed cd");
const m: any = /(?<num>\d+)-(?<opt>q)?(?<word>\w+)/.exec(text);
const copy: any = structuredClone(m);
console.log(Array.isArray(copy), copy.length, copy.index, copy.input, Object.keys(copy).join(","), copy.groups.num, copy.groups.opt, Object.getPrototypeOf(copy.groups) === Object.prototype, copy !== m);
// defineProperty on the compiled array itself.
const arr: any = /(a)(b)?/.exec("xa");
Object.defineProperty(arr, "tag", { value: "t", writable: true, enumerable: true, configurable: true });
Object.defineProperty(arr, "bare", { writable: true, enumerable: true, configurable: true });
Object.defineProperty(arr, "index", { value: 5 });
console.log(arr.tag, arr.bare, "bare" in arr, arr.index, Object.keys(arr).join(","));
