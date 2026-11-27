// @plain-native-only: TS `any` is a page value in the plain native lane; a class facade's constructor stands for the compiled class by name only
// @native-refuses: x.constructor.<static> on a compiled class instance held as `any` is a loud TypeError (it used to read undefined); x.constructor.name stays exact
// @expect-native: C
// @expect-native: TypeError true
class C { static s = 4; v = 1; }
const x: any = new C();
console.log(x.constructor.name);
try { void x.constructor.s; console.log("no error"); } catch (e) { console.log(`${(e as Error).name} ${(e as Error).message.includes("static member")}`); }
