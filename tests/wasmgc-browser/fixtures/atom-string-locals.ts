// String locals the program only ever spells as literals (atom strings, SCRIPTC_WASMGC_ATOM_STRINGS): an if-chain state
// machine, ternary writes, compares between two such locals and with literals, and every read as a string (template,
// length, Map key, JSON, a method) give Node's results.
type Mode = "idle" | "walk" | "run" | "swim" | "fly";
function step(flag: number): string {
  let m: Mode = "idle";
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    if (m === "idle") m = "walk";
    else if (m === "walk") m = i % 2 ? "run" : "swim";
    else if (m === "run") m = "fly";
    else if (m === "swim") m = "idle";
    else m = "idle";
    out.push(m, String(m.length), m === "fly" ? "F" : m !== "idle" ? "-" : "I");
  }
  const pick = flag > 0 ? "walk" : "idle";
  const empty = "";
  const same = pick === m, prior = pick !== "walk";
  const label = `${pick}:${m}:${empty}|`;
  const map = new Map<string, number>([[pick, 1]]);
  return [out.join(","), same, prior, label, map.get("walk") ?? "none", JSON.stringify({ pick, m }), pick.toUpperCase(), empty.length, empty === ""].join(" ");
}
console.log(step(1));
console.log(step(0));
