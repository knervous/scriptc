// @options: {"interfaceClassArms": true}
// F042: an array whose element union mixes a class instance and a record
// (both assignable to the interface), read through a view cast inside an
// array callback. The capture's narrowing is the element's own type; the view
// read then happens per arm. Neighbor: the same body in a for-of loop
// (f042-neighbor-direct.ts).
interface Surface { readonly format: string; device: { id: number }; }
class Engine implements Surface { readonly format = "bgra8unorm"; device = { id: 7 }; }
function deviceOf(s: Surface): number { return (s as unknown as { device: { id: number } }).device.id; }
const all: Surface[] = [new Engine(), { format: "rgba8unorm", device: { id: 9 } }];
console.log(all.map(deviceOf).join());
export {};
