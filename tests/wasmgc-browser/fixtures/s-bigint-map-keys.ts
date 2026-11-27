// @native-any-only: a page-made bigint reaches compiled code through an `any` value only in the native any model
// bigint Map / Set keys compare by value (SameValueZero): separately made equal bigints are one key; keys() / iteration return the original bigints in insertion
// order; computed (shift / mask) keys and page-made (opaque) bigints behave the same; a bigint under an `unknown` key follows the rule.
const BIAS = 1 << 20;
const MASK = (1n << 21n) - 1n;
function keyOf(x: number, y: number, z: number): bigint {
  const xb = BigInt(x + BIAS), yb = BigInt(y + BIAS), zb = BigInt(z + BIAS);
  if (xb < 0n || xb > MASK) throw new Error("x");
  return (xb << 42n) | (yb << 21n) | zb;
}
function unkey(key: bigint): number[] {
  return [Number((key >> 42n) & MASK) - BIAS, Number((key >> 21n) & MASK) - BIAS, Number(key & MASK) - BIAS];
}
const cells = new Map<bigint, string[]>();
function put(x: number, y: number, z: number, who: string): void {
  const k = keyOf(x, y, z);
  const list = cells.get(k);
  if (list) list.push(who); else cells.set(k, [who]);
}
put(1, 2, 3, "a"); put(-1, 0, 5, "b"); put(1, 2, 3, "c"); put(0, 0, 0, "d"); put(-1, 0, 5, "e");
console.log(cells.size, cells.has(keyOf(1, 2, 3)), cells.has(keyOf(9, 9, 9)), cells.get(keyOf(1, 2, 3))?.join("+"), cells.get(keyOf(-1, 0, 5))?.join("+"));
const order: string[] = [];
for (const [k, v] of cells) order.push(unkey(k).join(",") + "=" + v.join(""));
console.log(order.join(" | "));
console.log(cells.delete(keyOf(0, 0, 0)), cells.delete(keyOf(0, 0, 0)), cells.size, [...cells.keys()].map((k) => String(k)).join(","));
const first = [...cells.keys()][0]!;
console.log(typeof first, first === keyOf(1, 2, 3), String(first * 2n), first > 0n);

const seen = new Set<bigint>();
seen.add(10n ** 20n); seen.add(100000000000000000000n); seen.add(-(10n ** 20n)); seen.add(0n); seen.add(-0n);
console.log(seen.size, seen.has(10n ** 20n), seen.has(5n), [...seen].map((v) => v.toString()).join(","), seen.delete(0n), seen.size);

const loose = new Map<unknown, string>();
loose.set(7n, "seven"); loose.set(7, "number seven"); loose.set("7", "string seven"); loose.set(7n, "seven again");
console.log(loose.size, loose.get(7n), loose.get(7), loose.get("7"), loose.has(8n));

const big: any = (globalThis as any).auditBig();
const opaque = new Map<bigint, number>();
(big.ids as bigint[]).forEach((id, i) => opaque.set(id, i));
(big.again as bigint[]).forEach((id, i) => opaque.set(id, 10 + i));
console.log(opaque.size, [...opaque.values()].join(","), [...opaque.keys()].map((k) => k.toString()).join(","), opaque.get(BigInt(big.text)));
