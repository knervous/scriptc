// Long string keys (past the hash's whole-key length): keys that differ only in their middle, where the hash samples,
// must stay distinct entries; equal content found again from a separately built string; Set and delete alike.
const base = "x".repeat(5000);
const keys: string[] = [];
for (let i = 0; i < 200; i++) keys.push(base.slice(0, 2000 + i) + "Q" + base.slice(2001 + i));
keys.push(base);
keys.push(base + "!");
keys.push("short");
const map = new Map<string, number>();
keys.forEach((key, i) => map.set(key, i));
console.log(map.size);
let found = 0;
for (let i = 0; i < 200; i++) {
  const again = "x".repeat(2000 + i) + "Q" + "x".repeat(5000 - 2001 - i);
  if (map.get(again) === i) found++;
}
console.log(found, map.get("x".repeat(5000)), map.get("x".repeat(5000) + "!"), map.get("short"));
const set = new Set<string>(keys);
set.delete(keys[7]!);
console.log(set.size, set.has(keys[7]!), set.has(keys[8]!));
map.delete(keys[100]!);
console.log(map.size, map.has(keys[100]!), [...map.values()].slice(98, 102).join(","));
const near = new Map<string, number>();
for (let i = 0; i < 300; i++) near.set("y".repeat(257 + i), i);
let ok = 0;
for (let i = 0; i < 300; i++) if (near.get("y".repeat(257 + i)) === i) ok++;
console.log(near.size, ok);
