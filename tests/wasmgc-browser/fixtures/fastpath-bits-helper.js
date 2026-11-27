// Bitwise flags on engine values (compiled as JavaScript).
export function bitsGrid(bits, id) {
  const out = [];
  for (let i = 0; i < bits.length; i++) for (let j = 0; j < bits.length; j++) { const x = id(bits[i]), y = id(bits[j]); out.push(`${x & y},${x | y}`); }
  return out.join(" ");
}
