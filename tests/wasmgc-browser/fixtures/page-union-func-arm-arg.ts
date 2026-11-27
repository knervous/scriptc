// @options: {"interfaceClassArms": true}
// A union with a function arm crossing to the page as a call argument (React's
// dependency list: `[expectedValue]` where expectedValue is `Entity | null | ((v) => boolean)`).
class Entity { name = "e"; }
const h: any = globalThis;
const deps: any = h.auditIdentity;
const pick = (flag: number): Entity | null | ((v: Entity | null) => boolean) =>
  flag === 0 ? new Entity() : flag === 1 ? null : (v) => v !== null;
for (const flag of [0, 1, 2]) {
  const expected = pick(flag);
  const echoed = deps([expected]);
  const first = echoed[0];
  console.log(flag, typeof first, typeof first === "function" ? first(new Entity()) : first === null ? "null" : first.name);
}
