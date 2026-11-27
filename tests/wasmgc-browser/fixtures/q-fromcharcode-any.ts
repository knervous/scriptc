// String.fromCharCode over any-typed arguments: ToNumber each argument, then ToUint16.
const a: any = "66";
const b: any = 67;
console.log(String.fromCharCode(a, b));
const c: any = "0x41", d: any = true, i: any = "  68  ";
console.log(String.fromCharCode(c, d, i).length, String.fromCharCode(c) === "A", String.fromCharCode(i) === "D");
console.log(String.fromCharCode("66" as any, 67).length, String.fromCharCode([69] as any) === "E");
const obj: any = { valueOf() { return 70; } };
console.log(String.fromCharCode(obj));
let order = "";
const o1: any = { valueOf() { order += "1"; return 71; } }, o2: any = { valueOf() { order += "2"; return 72; } };
console.log(String.fromCharCode(o1, o2), order);
console.log(String.fromCharCode("abc" as any).charCodeAt(0));
