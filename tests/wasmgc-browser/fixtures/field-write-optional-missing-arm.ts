// @options: {"interfaceClassArms": true}
// Two object shapes flow into one interface, Gpu, whose optional fields
// capacity and scratch only one shape declares. A literal of the narrower
// Narrow shape is passed where Gpu is expected; provision() writes the
// optional fields and a required one through the interface and reads them
// back. Both objects, their original variables and a Gpu[] view all show the
// writes, and a field the narrow shape never had reads undefined first.
interface Gpu { count: number; capacity?: number; scratch?: Uint32Array }
interface Narrow { count: number }

const full: Gpu = { count: 1, capacity: 4, scratch: new Uint32Array(2) };
const narrow: Narrow = { count: 2 };
const narrowGpu: Gpu = narrow;
const gpus: Gpu[] = [full, narrow];

function provision(gpu: Gpu, cap: number): number {
  const s = new Uint32Array(cap);
  s[0] = cap * 10;
  gpu.capacity = cap;
  gpu.scratch = s;
  gpu.count += 1;
  return (gpu.capacity ?? 0) + (gpu.scratch?.length ?? 0) + gpu.count;
}

console.log(narrowGpu.capacity, narrowGpu.scratch);
// Presence: the narrow object has no capacity until a write adds one (JSON and
// `in`; Object.keys over unset optional fields is a separate, pre-existing root).
const probe: Narrow = { count: 7 };
const probeGpu: Gpu = probe;
console.log(JSON.stringify(probe), "capacity" in probe);
probeGpu.capacity = 9;
console.log(JSON.stringify(probe), "capacity" in probe);
const r1 = provision(full, 4);
const r2 = provision(narrow, 8);
console.log(r1, r2);
console.log(full.count, full.capacity, full.scratch?.length, full.scratch?.[0]);
console.log(narrow.count, narrowGpu.capacity, narrowGpu.scratch?.length, narrowGpu.scratch?.[0]);
for (const g of gpus) console.log("view", g.count, g.capacity, g.scratch?.length, g.scratch?.[0]);
console.log("same", narrowGpu === narrow, gpus[1] === narrow);
