// @native-only: the engine dyn model keeps its loud fences for an untyped executor and a void throw
// react-dom/react idioms (void throw, null callee, null for-in, null compound target, func.call, Promise<any>) that refused in the whole-client build
import { updateForward, setProp, startHost, throwVoid, callNullable, styles, bailout, mapChildren, preload } from "./react-idioms-helper.js";
try { throwVoid(null); } catch (e) { console.log((e as Error).message); }
console.log(throwVoid(3));
console.log(typeof callNullable(null, 1), callNullable(null, 1)(), typeof callNullable(undefined, 1));
console.log(callNullable(function (d: number) { return d + 1; } as any, 4)());
console.log(styles({ style: 1 }, null, undefined), styles({ style: 1 }, null, null), styles({}, { a: 1 }, { a: 1, b: 2 }));
try { bailout(null, {}, 1); } catch (e) { console.log((e as Error).name); }
try { bailout(undefined, {}, 1); } catch (e) { console.log((e as Error).name); }
const cur = { updateQueue: 1, lanes: 7 }, wip: any = {};
bailout(cur, wip, 2); console.log(cur.lanes, wip.updateQueue, wip.flags);
console.log(mapChildren(null, () => 1, null), mapChildren([1, 2], function () { return "x"; }, {}));
const link: any = {};
preload(link);
link._p.then((v: any) => console.log("loaded", v));
link.onload("ok");
const link2: any = {};
preload(link2);
link2._p.then(() => console.log("no"), (r: any) => console.log("rejected", r));
link2.onerror("bad");
const u1: unknown = { style: 1 }, u2: unknown = { color: "red" };
const nul: null | undefined = Math.random() > 2 ? undefined : null;
console.log(updateForward(nul, u1, u2), updateForward(cur, JSON.parse("{}"), 1));
console.log(setProp(u1, u2, nul), setProp(u1, u2, { color: "red" }));
const runner = { run: (f: () => unknown) => f() };
console.log(startHost(u1, runner, nul, u2), startHost(u1, runner, (d: unknown) => "called" + String(d === u2), u2));
const seen: unknown[] = [];
console.log(mapChildren([5, 6] as unknown, function () { seen.push(1); }, u2), seen.length);
