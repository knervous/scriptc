// @native-only: the engine dyn model keeps its loud fences for null-specialised receivers and Function.prototype.call
// react-dom/react idioms in an npm-static package (the whole-client build compiles react that way): a for-in and a compound assignment over
// a null-specialised parameter, a call of a null callee, Function.prototype.call on a typed function value.
// @options: {"npmStatic": ["ridioms"]}
import { fiA, fiB, cpC, cpD, cnE, cnF, mapG, forEachG } from "./react-idioms2-lib/node_modules/ridioms/index.js";
const u1: unknown = { a: 1 }, u2: unknown = 2;
const nul: null | undefined = Math.random() > 2 ? undefined : null;
console.log(fiA(u1, u2, nul), fiA(u1, u2, null), fiA(u1, u2, { x: 1, y: 2 }));
console.log(fiB(u1, u2, nul), fiB(u1, u2, null), fiB(u1, u2, { x: 1 }));
for (const f of [() => cpC(nul, u1, u2), () => cpC(null, u1, u2), () => cpD(nul, u1, u2), () => cpD(undefined, u1, u2)]) {
  try { f(); console.log("no throw"); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
}
try { cnE(null, u1); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
try { cnE(nul, u1); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
const runner = { run: (f: () => unknown) => f() };
console.log(cnF(u1, runner, nul, u2), cnF(u1, runner, (d: unknown) => "called" + String(d === u2), u2), cnF(u1, runner, null, u2));
const seen: number[] = [];
console.log(mapG([5, 6], function () { seen.push(1); }, u2), seen.length);
console.log(mapG(null, () => 1, null), mapG([7], function (c: number) { return c * 2; }, nul));
forEachG([1, 2, 3], function () { seen.push(2); }, u1);
console.log(seen.join());
