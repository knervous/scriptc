// Inline scalar-union record fields seen through dyn/any: JSON round trip, structuredClone, width coercion into a wider and a
// narrower shape, for-in and writes through any.
interface Narrow { id: number; hp?: number }
interface Wide { id: number; hp?: number; mana: number | null; ok?: boolean }
const n: Narrow = { id: 1 };
const wide: Wide = { id: 2, hp: 5, mana: null };
const asNarrow: Narrow = wide;
console.log(asNarrow.hp, JSON.stringify(asNarrow));
asNarrow.hp = undefined;
console.log(wide.hp, JSON.stringify(wide), "mana" in wide);
const parsed = JSON.parse('{"id":3,"hp":4,"mana":1.5,"ok":true}') as Wide;
console.log(parsed.hp, parsed.mana, parsed.ok, JSON.stringify(parsed));
parsed.hp = (parsed.hp ?? 0) * 2; parsed.mana = null; parsed.ok = undefined;
console.log(JSON.stringify(parsed), parsed.ok);
const partial = JSON.parse('{"id":4,"mana":null}') as Wide;
console.log(partial.hp, partial.mana, partial.ok, "hp" in partial, JSON.stringify(partial));
const clone = structuredClone(wide);
clone.hp = 8;
console.log(JSON.stringify(clone), JSON.stringify(wide));
const keys: string[] = [];
for (const k in clone) keys.push(k);
console.log(keys.join(","));
const d: any = n;
d.hp = 41;
console.log(n.hp, d.hp + 1, JSON.stringify(n));
d.hp = undefined;
console.log(n.hp, JSON.stringify(n));
const list: any[] = [wide, n, parsed];
console.log(list.map((o) => o.hp).join(","), list.map((o) => o.mana).join(","));
const copy = { ...partial, ok: false };
console.log(JSON.stringify(copy), copy.ok, copy.hp);
