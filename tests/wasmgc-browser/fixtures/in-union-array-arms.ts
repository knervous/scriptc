class Vec { x = 1; y = 2; z = 3; }
type Any3 = number[] | Float32Array | Vec | { x: number; y: number; z: number };
function hasX(v: Any3): boolean { return "x" in v; }
function hasZero(v: Any3): boolean { return "0" in v; }
function hasLen(v: Any3): boolean { return "length" in v; }
const vals: Any3[] = [[1, 2, 3], new Float32Array(3), new Vec(), { x: 1, y: 2, z: 3 }];
for (const v of vals) console.log(hasX(v), hasZero(v), hasLen(v));
console.log("5" in vals[0]!, "2" in vals[1]!);
