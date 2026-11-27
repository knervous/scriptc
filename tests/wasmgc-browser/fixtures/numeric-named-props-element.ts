interface RaceEntry { 0: string; 1: string; 2: string; name: string; scale?: number }
interface RaceData { [key: number]: RaceEntry }
const DATA: RaceData = {
  "1": { "0": "HUM", "1": "HUF", "2": "", name: "Human", scale: 1.2 },
  "2": { "0": "BAM", "1": "BAF", "2": "x", name: "Solskar" },
};
function key(race: number, gender?: number): string {
  const entry = DATA[race] ?? DATA[1]!;
  const models: readonly string[] = [entry[0], entry[1], entry[2]];
  const picked = models[gender ?? 0]!;
  return picked === "" ? models[0]! : picked;
}
console.log(key(1), key(1, 1), key(2), key(2, 1), key(9, 1));
const e = DATA[2]!;
console.log(e[0], e[1], e[2], e.name, e.scale);
// Same read through the string-literal spelling, and heterogeneous field types.
const f = DATA[1]!;
console.log(f["0"], f["1"], f.scale === undefined ? "none" : f.scale);
