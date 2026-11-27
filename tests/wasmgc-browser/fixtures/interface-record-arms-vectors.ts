// @options: {"interfaceClassArms": true}
// A vector-shaped interface that a class, a wider record and its own literals
// all flow into: literals build the base record, the class and the wider
// record are held by reference, and reads dispatch per arm.
interface Vec3 { x: number; y: number; z: number }
interface Vec3Like { readonly x: number; readonly y: number; readonly z: number }
class Vector3 {
  x = 0;
  y = 0;
  z = 0;
}
interface Body { position: Vec3; radius: number }
function len(v: Vec3Like): number { return Math.hypot(v.x, v.y, v.z); }
function norm(v: Vec3): Vec3 { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
const body: Body = { position: { x: 1, y: 2, z: 2 }, radius: 1 };
const tagged = { x: 3, y: 0, z: 4, tag: "t" };
console.log(len(body.position), len(new Vector3()), norm(tagged).x, len(tagged), len(norm(new Vector3())));
function scale(v: Vec3, k: number): void { v.x *= k; v.y *= k; v.z *= k; }
const cls = new Vector3();
cls.x = 1;
scale(cls, 2);
scale(tagged, 0.5);
scale(body.position, 3);
console.log(cls.x, tagged.x, tagged.tag, body.position.z);
