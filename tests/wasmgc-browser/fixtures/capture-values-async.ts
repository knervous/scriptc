// Async and generator closures that capture bindings and resume (ir/capture-values.ts).
function* counter(limit: number, step: number) {
  const scale = 10;
  const tag = "g";
  const fmt = (i: number) => `${tag}${i * scale}`;
  for (let i = 0; i < limit; i += step) yield fmt(i);
}
console.log("gen", [...counter(5, 2)].join(","));

function makeGen() {
  const base = 3;
  let changed = 1;
  const gen = function* () {
    for (let i = 0; i < 3; i++) { yield base + i + changed; }
  };
  const it = gen();
  const a = it.next().value;
  changed = 100;
  const b = it.next().value;
  return `${a} ${b} ${it.next().value}`;
}
console.log("makeGen", makeGen());

async function tick(v: number): Promise<number> { return v; }

async function run(): Promise<string> {
  const factor = 4;
  let live = 1;
  const work = async (n: number): Promise<number> => {
    const a = await tick(n * factor);
    const b = await tick(live);
    return a + b + factor;
  };
  const p = work(2);
  live = 50;
  const r1 = await p;
  const results = await Promise.all([1, 2, 3].map(async (k) => (await tick(k)) * factor));
  const nestedAsync = async () => { const inner = async () => factor + live; return await inner(); };
  return `${r1} ${results.join(",")} ${await nestedAsync()}`;
}
run().then((s) => console.log("async", s));
