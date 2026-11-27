// Scalar-union record fields stored inline (number | undefined, number | null, boolean | undefined, boolean | null):
// set, unset, reassigned; NaN and -0 kept; JSON drops an undefined field. (Keys are listed in declared order and
// presence is asked only of defined fields: an explicit undefined is absent in this compiler's record stance.)
interface Unit { id: number; hp?: number; target: number | undefined; regen: number | null; flag?: boolean; lock: boolean | null; both?: number | null }
const u: Unit = { id: 1, hp: undefined, target: undefined, regen: null, flag: undefined, lock: null, both: undefined };
console.log(u.hp, u.target, u.regen, u.flag, u.lock, u.both);
console.log(JSON.stringify(u), "regen" in u, Object.prototype.hasOwnProperty.call(u, "lock"));
u.hp = 10; u.target = 0; u.regen = 2.5; u.flag = false; u.lock = true; u.both = null;
console.log(u.hp, u.target, u.regen, u.flag, u.lock, u.both);
console.log(JSON.stringify(u), Object.keys(u).join(","), "hp" in u, Object.prototype.hasOwnProperty.call(u, "flag"));
u.hp = NaN; u.target = -0; u.regen = NaN; u.both = -0;
console.log(u.hp, Number.isNaN(u.hp), u.hp === undefined, Object.is(u.target, -0), Object.is(u.both, -0), Number.isNaN(u.regen), u.regen === null);
console.log(JSON.stringify(u));
u.hp = undefined; u.regen = null; u.flag = undefined; u.lock = false; u.both = undefined;
console.log(u.hp, u.regen, u.flag, u.lock, u.both, JSON.stringify(u));
// Reads that only narrow, test or default.
const hp = u.hp ?? -1, t = u.target === undefined ? -2 : u.target + 1, r = u.regen !== null ? u.regen : -3;
console.log(hp, t, r, typeof u.hp, typeof u.target, typeof u.regen, typeof u.lock, String(u.flag));
// Strict equality between fields and against constants.
const v: Unit = { id: 2, hp: 3, target: 3, regen: 3, flag: true, lock: false, both: 1 };
console.log(v.hp === v.target, v.hp === 3, v.regen === v.hp, u.hp === v.flag, u.lock === v.lock, v.flag === undefined, u.hp !== u.both);
// Copies between fields, spread, Object.assign.
v.target = u.target; v.regen = u.regen; v.hp = v.target;
console.log(v.hp, v.target, v.regen);
v.target = 6; v.hp = 4;
const w = { ...v }; w.hp = 99;
const x = Object.assign({}, v, { regen: 7 });
console.log(JSON.stringify(w), JSON.stringify(x), Object.keys(w).join(","));
// Arrays of such records.
const rows: Unit[] = [];
for (let i = 0; i < 6; i++) rows.push({ id: i, hp: i % 2 ? i * 10 : undefined, target: i % 3 ? undefined : i, regen: i > 3 ? null : i / 2, flag: i % 2 === 0, lock: i === 5 ? null : i > 2, both: i === 1 ? null : i });
let sum = 0;
for (const row of rows) { if (row.hp !== undefined) sum += row.hp; row.hp = (row.hp ?? 0) + 1; sum += row.regen ?? 100; }
console.log(sum, JSON.stringify(rows));
console.log(rows.map((q) => `${q.hp}/${q.target}/${q.regen}/${q.flag}/${q.lock}/${q.both}`).join(" "));
// Width: a narrower view of the same record writes the shared fields.
interface Thin { id: number; hp?: number }
const thin: Thin = rows[2]!;
thin.hp = 1234;
console.log(rows[2]!.hp, JSON.stringify(thin) === JSON.stringify(rows[2]));
// Truthiness of inline fields: 0, -0, NaN, undefined and null are falsy.
const probes: Unit[] = [
  { id: 0, hp: 0, target: -0, regen: NaN, flag: false, lock: null, both: null },
  { id: 1, hp: 2, target: undefined, regen: null, flag: true, lock: true, both: -1 },
  { id: 2, hp: undefined, target: 0.5, regen: 3, flag: undefined, lock: false, both: undefined },
];
console.log(probes.map((p) => `${p.hp ? 1 : 0}${p.target ? 1 : 0}${p.regen ? 1 : 0}${p.flag ? 1 : 0}${p.lock ? 1 : 0}${p.both ? 1 : 0}${!p.hp}`).join(" "));
