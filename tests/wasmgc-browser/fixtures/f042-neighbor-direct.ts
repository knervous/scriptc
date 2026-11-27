// @options: {"interfaceClassArms": true}
// F042 neighbor (passes). Same classes, same view-cast reader, same mixed
// class/record array as f042-union-array-callback.ts, but the elements are
// read by a for-of loop rather than inside an array callback. Expected
// stdout: 7,9
interface Surface { readonly format: string; device: { id: number }; }
class Engine implements Surface { readonly format = "bgra8unorm"; device = { id: 7 }; }
function deviceOf(s: Surface): number { return (s as unknown as { device: { id: number } }).device.id; }
const all: Surface[] = [new Engine(), { format: "rgba8unorm", device: { id: 9 } }];
const out: number[] = [];
for (const s of all) out.push(deviceOf(s));
console.log(out.join());
export {};
