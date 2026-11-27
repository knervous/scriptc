// Class instances as Map / Set / WeakMap keys on the browser: the hash is the instance's own lazily assigned id (read inside
// Wasm, no page crossing). Lookups find each key by identity, never a look-alike; deletion and re-insertion leave the entry at the
// end of the iteration order; a base class and its subclass share one Map; and many keys of one class spread over the buckets
// (a hash that gave every instance one value would make this Map a linked list: the scaling check below).
// @hits(native,native-any): ^\$hash\.
class Mesh { readonly name: string; visible = true; constructor(name: string) { this.name = name; } }
class Skinned extends Mesh { bones = 4; }
const meshes: Mesh[] = [];
for (let i = 0; i < 300; i++) meshes.push(i % 3 === 0 ? new Skinned("m" + i) : new Mesh("m" + i));
const byMesh = new Map<Mesh, number>();
const seen = new Set<Mesh>();
const weak = new WeakMap<Mesh, string>();
meshes.forEach((m, i) => { byMesh.set(m, i); seen.add(m); weak.set(m, m.name); });
let ok = byMesh.size === 300 && seen.size === 300;
meshes.forEach((m, i) => { if (byMesh.get(m) !== i || !seen.has(m) || weak.get(m) !== m.name) ok = false; });
const twin = new Mesh("m0");
console.log(ok, byMesh.has(twin), seen.has(twin), weak.has(twin), byMesh.get(twin));
// deletion and re-insertion: the entry moves to the end; the others keep their order
console.log(byMesh.delete(meshes[5]), byMesh.delete(meshes[5]), byMesh.size, byMesh.has(meshes[5]), seen.delete(meshes[7]), seen.has(meshes[7]), weak.delete(meshes[9]), weak.has(meshes[9]));
byMesh.set(meshes[5], -5); seen.add(meshes[7]); weak.set(meshes[9], "again");
const order = [...byMesh.keys()].map((m) => m.name);
console.log(order.length, order.slice(0, 6).join(), order.slice(-3).join(), byMesh.get(meshes[5]), seen.has(meshes[7]), [...seen].at(-1)!.name, weak.get(meshes[9]));
// overwrite keeps the position; a second set of the same key does not add one
byMesh.set(meshes[1], 100); byMesh.set(meshes[1], 101);
console.log(byMesh.size, [...byMesh.keys()][1]!.name, byMesh.get(meshes[1]));
// insertion order, entries and forEach
const first = new Map<Mesh, number>([[meshes[3], 3], [meshes[1], 1], [meshes[2], 2]]);
const seenOrder: string[] = [];
first.forEach((v, k) => seenOrder.push(k.name + "=" + v));
console.log(seenOrder.join(), [...first.entries()].map(([k, v]) => k.name + v).join());
// a mutation of the key's fields does not change its identity
meshes[4]!.visible = false;
console.log(byMesh.get(meshes[4]), seen.has(meshes[4]));
// many keys of one class: linear, not quadratic (a constant hash would make 20000 keys cost 200 million probes)
const batch = (n: number): Mesh[] => { const out: Mesh[] = []; for (let i = 0; i < n; i++) out.push(new Mesh("b" + i)); return out; };
const run = (keys: Mesh[], rounds: number): number => {
  const t0 = performance.now();
  let sum = 0;
  for (let r = 0; r < rounds; r++) {
    const map = new Map<Mesh, number>();
    for (let i = 0; i < keys.length; i++) map.set(keys[i]!, i);
    for (let i = 0; i < keys.length; i++) sum += map.get(keys[i]!)!;
    for (let i = 0; i < keys.length; i++) if (!map.has(keys[i]!)) sum = -1;
  }
  if (sum < 0) throw new Error("lookup failed");
  return performance.now() - t0;
};
const small = batch(500), large = batch(20000);
let tSmall = Infinity, tLarge = Infinity;
for (let rep = 0; rep < 3; rep++) { tSmall = Math.min(tSmall, run(small, 80)); tLarge = Math.min(tLarge, run(large, 2)); }
console.log("scales linearly", tLarge < tSmall * 6 + 20);
