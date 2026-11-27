// Class fields with `?`, `| undefined`, `| null` and boolean unions stored inline: defaults, writes, NaN, reads through any.
class Mob {
  name = "m";
  hp?: number;
  target: number | undefined;
  regen: number | null = null;
  aggro?: boolean;
  seen: boolean | null = null;
  cooldown: number | undefined = 5;
}
class Boss extends Mob { phase?: number; enraged: boolean | undefined = false; }
const m = new Mob();
console.log(m.hp, m.target, m.regen, m.aggro, m.seen, m.cooldown, JSON.stringify(m), Object.keys(m).join(","));
m.hp = 12; m.target = 4; m.regen = 0.5; m.aggro = true; m.seen = false; m.cooldown = undefined;
console.log(m.hp, m.target, m.regen, m.aggro, m.seen, m.cooldown, JSON.stringify(m), Object.keys(m).join(","));
m.hp = NaN; m.target = -0;
console.log(Number.isNaN(m.hp), m.hp === undefined, Object.is(m.target, -0), 1 / (m.target ?? 1));
const b = new Boss();
b.phase = 2; b.hp = 100;
console.log(b.phase, b.hp, b.enraged, b.seen, JSON.stringify(b), "phase" in b, b.hasOwnProperty("hp"));
b.enraged = undefined; b.phase = undefined;
console.log(b.enraged, b.phase, JSON.stringify(b));
// Through any: reads, writes, `in`, keys, delete.
const a: any = b;
console.log(a.hp, a.phase, a.regen, a.enraged, a.cooldown);
a.hp = 7; a.regen = 3; a.phase = 9;
console.log(b.hp, b.regen, b.phase, a.hp + a.regen);
a.hp = undefined;
console.log(b.hp, "hp" in a, Object.keys(a).join(","), JSON.stringify(a));
const mobs: Mob[] = [new Mob(), new Boss(), new Mob()];
let total = 0;
for (let tick = 0; tick < 5; tick++) for (let i = 0; i < mobs.length; i++) {
  const x = mobs[i]!;
  x.hp = (x.hp ?? 0) + i;
  x.target = x.target === undefined ? tick : undefined;
  x.aggro = !x.aggro;
  total += x.hp + (x.target ?? -1) + (x.aggro ? 1 : 0);
}
console.log(total, mobs.map((x) => `${x.hp}:${x.target}:${x.aggro}`).join(" "));
function dump(o: { hp?: number; regen: number | null }): string { return `${o.hp}|${o.regen}`; }
console.log(dump(m), dump(b), dump({ regen: null }));
