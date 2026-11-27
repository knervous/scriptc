// @options: {"hostHandles": true}
// new X() where X is an absent page global, undefined, or a primitive throws TypeError.
const g = globalThis as any;
function tryNew(label: string, make: () => unknown) {
  try { make(); console.log(label, "constructed"); } catch (e) { console.log(label, e instanceof TypeError ? "TypeError" : "other"); }
}
tryNew("absent", () => new g.NoSuchGlobalClass());
tryNew("absent-args", () => new g.NoSuchGlobalClass(1, 2));
const holder: any = { n: 5, s: "str", u: undefined, z: null };
tryNew("number", () => new holder.n());
tryNew("string", () => new holder.s());
tryNew("undefined", () => new holder.u());
tryNew("null", () => new holder.z());
tryNew("ok", () => { new g.Date(5); });
console.log(new g.Date(0).getTime());
console.log(typeof new g.Date(5));
