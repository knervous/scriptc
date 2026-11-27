export function objects() { return [{ x: 1, w: "a" }, { x: 2, v: "b" }, [1, 2, 3], [5]]; }
export function readBack(a, b, c, d) { return [a.x, a.y, b.v, b.g, c.length, c[0], c[6], d.length, d[2]].join(","); }
