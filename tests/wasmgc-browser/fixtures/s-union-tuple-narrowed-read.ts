// @native-only: the engine lane has no compiled tuple records to read through a dyn check
// @options: {"interfaceClassArms": true}
// A tuple element read through an optional chain on a union property the checker narrowed (`typeof x.scale === "number"` returned early): the read goes through the
// tuple arm of the retagged union, never the union value itself.
export type F = { scale?: number | [number, number, number]; pos?: [number, number, number] };
function f(fit: F): number { if (typeof fit.scale === "number") return fit.scale; return fit.scale?.[0] ?? 1; }
console.log(f({ scale: 2 }), f({ scale: [3, 3, 3] }), f({}));
