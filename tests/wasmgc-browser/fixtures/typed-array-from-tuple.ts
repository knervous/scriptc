// new Float64Array(tuple) over a tuple of numbers (the glTF translation/rotation/scale idiom): the elements, in order, copied.
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
function make(): Vec3 { console.log("make"); return [1, 2.5, -3]; }
const t: Vec3 = [4, 5, 6];
const a = new Float64Array(t);
t[0] = 99;
console.log(a.length, Array.from(a).join(","), t[0]);
console.log(Array.from(new Float32Array(make())).join(","));
const q: Quat = [0, 0.5, 0, 0.5];
console.log(Array.from(new Float32Array(q)).join(","), Array.from(new Int8Array(q)).join(","));
const node: { translation: Vec3; rotation: Quat } = { translation: [1, 2, 3], rotation: [0, 0, 0, 1] };
const m = new Float32Array(node.translation.length + node.rotation.length);
m.set(new Float32Array(node.translation), 0);
m.set(new Float32Array(node.rotation), 3);
console.log(Array.from(m).join(","));
