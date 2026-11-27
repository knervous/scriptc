// @options: {"interfaceClassArms": true}
// clearTimeout of an `any`-typed value (a React ref's .current after generic
// erasure) with a -1 fallback: absent or foreign handles clear nothing.
const vals: any[] = [undefined, null, 12345, "x"];
for (const v of vals) clearTimeout(v ?? -1);
for (const v of vals) clearTimeout(v);
console.log("done");

// A live handle held as `any` / `unknown` clears the timer; the siblings
// (clearInterval, clearImmediate) take the same dynamic handles.
const held: { current: any } = { current: undefined };
let ran = 0;
held.current = setTimeout(() => { ran++; console.log("timeout survived"); }, 5);
clearTimeout(held.current);
const iv: any = setInterval(() => { ran++; console.log("interval survived"); }, 2);
clearInterval(iv);
const im: any = setImmediate(() => { ran++; console.log("immediate survived"); });
clearImmediate(im);
const unk: unknown = { not: "a handle" };
clearInterval(unk as any);
clearImmediate(undefined as any);
const live: any = setTimeout(() => console.log("live fired", ran), 15);
void live;
