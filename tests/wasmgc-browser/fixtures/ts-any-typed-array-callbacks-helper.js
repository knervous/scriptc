export function walk(xs) {
  let same = 0;
  xs.forEach((x, i, arr) => { if (arr === xs) same++; if (i === 0) arr[2] = 60; });
  const mapped = xs.map((x, i, arr) => (arr === xs ? x : -1)).join("+");
  const total = xs.reduce((s, x, i, arr) => s + (arr === xs ? x : 0), 0);
  return same + " " + mapped + " " + total + " " + xs.some((x, i, arr) => arr === xs && x === 60);
}
