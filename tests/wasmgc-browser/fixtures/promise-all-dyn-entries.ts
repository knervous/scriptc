// @native-only: engine-dyn has no checked iteration of a Map keyed by unknown (dynIterN)
// Promise.all over promises whose value type is checked-dynamic (a Map keyed
// by unknown): the combined value is the array of results by INPUT index
// whatever the settlement order (the first entry settles last), flatMap
// supplies the optional entries, an empty list resolves at once, and the
// first rejection wins.
interface Frag { n: number }
interface Feature { name: string; load?(ticks: number): Promise<Map<unknown, Frag>> }
const frag = (entries: [unknown, number][]): Map<unknown, Frag> => {
  const m = new Map<unknown, Frag>();
  for (const [k, n] of entries) m.set(k, { n });
  return m;
};
const after = (ticks: number, value: Map<unknown, Frag>): Promise<Map<unknown, Frag>> => {
  let p: Promise<Map<unknown, Frag>> = Promise.resolve(value);
  for (let i = 0; i < ticks; i++) p = p.then((v) => v);
  return p;
};
const features: Feature[] = [
  { name: "a", load: (t) => after(t, frag([["a", 1]])) },
  { name: "b" },
  { name: "c", load: (t) => after(t, frag([["c", 3], [7, 4]])) },
];
async function main(): Promise<void> {
  const order: string[] = [];
  const merged = new Map<unknown, Frag>();
  for (const part of await Promise.all(features.flatMap((f) => (f.load ? [f.load(f.name === "a" ? 6 : 1).then((m) => { order.push(f.name); return m; })] : [])))) {
    for (const [k, v] of part) merged.set(k, v);
  }
  console.log(order.join(","), merged.get("a")?.n, merged.get("c")?.n, merged.get(7)?.n);
  const none = await Promise.all(features.flatMap((f) => (f.name === "zzz" && f.load ? [f.load(1)] : [])));
  console.log(none.length);
  try {
    const rejecting = Promise.reject<Map<unknown, Frag>>(new Error("early"));
    await Promise.all(features.flatMap((f) => (f.load ? [f.load(5)] : [])).concat([rejecting]));
  } catch (e) {
    console.log("rejected", (e as Error).message);
  }
}
main();
