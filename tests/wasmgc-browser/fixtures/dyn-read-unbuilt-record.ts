// @options: {"hostHandles": true}
// @native-only: the native host profile's static-ctor read arms
// A dyn property read whose key a typed record declares, while no reachable code builds that record (its only literal
// sits in a function nothing calls): the read must not test against a struct the module never defines.
interface Palette { zzAccent: string; zzTone: number }
function neverCalled(): Palette { return { zzAccent: "red", zzTone: 3 }; }
if (0 > 1) neverCalled();
const live: any = JSON.parse('{"zzAccent":"blue","zzTone":7}');
function read(o: any): string { return o.zzAccent + ":" + o.zzTone; }
console.log(read(live), read({ zzAccent: "green", zzTone: 1 }));
