// Stable captures a closure reads only on a rare path stay reads of the environment at their use (no entry copy);
// captures read in a loop, and literal captures, are copied at entry. Either way every read sees the declaration's value.
class Mesh { version = 0; name: string; constructor(name: string) { this.name = name; } }
type Scene = { lights: number[]; label: string };

function makeUpdater(mesh: Mesh, scene: Scene, scale: number, tag: string) {
  const data = new Float32Array(4);
  const weights = [1, 2, 3];
  const limit = 3;
  const log: string[] = [];
  let last = -1;
  const update = (): number => {
    if (mesh.version === last) return 0; // the common path reads mesh only
    last = mesh.version;
    let sum = 0;
    for (let i = 0; i < weights.length && i < limit; i++) sum += weights[i]! * scale; // loop reads: weights, limit, scale
    data[0] = sum;
    data[1] = scene.lights.length;
    log.push(`${tag}:${mesh.name}:${scene.label}:${sum}`);
    return sum;
  };
  return { update, log, data };
}

const mesh = new Mesh("crate");
const scene: Scene = { lights: [1, 2], label: "hall" };
const u = makeUpdater(mesh, scene, 0.5, "pbr");
const results: number[] = [];
for (let frame = 0; frame < 6; frame++) {
  if (frame === 2 || frame === 4) mesh.version++;
  scene.lights.push(frame);
  results.push(u.update());
}
console.log(results.join(","), u.log.join(" "), Array.from(u.data).join(","));

// A capture read once on each of two paths, and one read in a nested closure created on the rare path.
function counter(start: number, step: number, label: string) {
  let n = start;
  return (bump: boolean): string => {
    if (!bump) return `${label}=${n}`;
    n += step;
    const describe = () => `${label}+${step}`;
    return describe();
  };
}
const c = counter(10, 3, "c");
console.log(c(false), c(true), c(true), c(false));

// Captures in a do-while and a for-of, and a literal capture used as an integer bound.
function sums(xs: number[]) {
  const k = 4;
  const bias = xs.length;
  return () => {
    let i = 0, acc = 0;
    do { acc += i * k + bias; i++; } while (i < k);
    for (const x of xs) acc += x;
    return acc;
  };
}
console.log(sums([5, 6, 7])());
