// @options: {"hostHandles": true}
// @native-any-only: JSON.stringify of any-typed values meets the dyn serializer only in the native any model
// JSON.stringify over dyn values, compiled-side (SerializeJSONProperty): key order, toJSON, replacer function and array,
// indent and gap, nested arrays and objects, undefined/function/symbol omission, non-finite numbers, cycles, BigInt, page values.
const g = globalThis as any;
const o: any = { b: 1, a: [1, "two", null, undefined, () => 1], c: { d: true, e: undefined, f: NaN }, "q\"uote": "x\ny" };
console.log(JSON.stringify(o));
console.log(JSON.stringify(o, null, 2));
console.log(JSON.stringify(o, null, "--"));
console.log(JSON.stringify(o, ["a", "c", "d", "a"]));
console.log(JSON.stringify(o, (_k: string, v: any) => (typeof v === "number" ? v * 10 : v)));
console.log(JSON.stringify({ x: 1, y: { z: 2 } }, (k: string, v: any) => (k === "" || typeof v === "object" ? v : k + ":" + v)));
const withToJSON: any = { n: 1, toJSON(key: string) { return { replaced: key }; } };
console.log(JSON.stringify(withToJSON), JSON.stringify({ k: withToJSON }), JSON.stringify([withToJSON]));
console.log(JSON.stringify(undefined as any), JSON.stringify((() => 1) as any), JSON.stringify(null as any), JSON.stringify("s" as any), JSON.stringify(3 as any), JSON.stringify(true as any));
console.log(JSON.stringify([] as any), JSON.stringify({} as any), JSON.stringify([[], {}] as any, null, 1));
const cyc: any = { name: "c" }; cyc.self = cyc;
try { JSON.stringify(cyc); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
const big: any = g.BigInt(5);
try { JSON.stringify({ big }); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
// page values inside compiled values, and page values at the root
const page = new g.Object(); page.p = 1; page.q = [1, 2]; page.date = new g.Date(0);
console.log(JSON.stringify({ page }), JSON.stringify(page), JSON.stringify([page, new g.Array(1, 2)]));
const symObj: any = { k: g.Symbol("v") }; symObj[g.Symbol("s")] = 1;
console.log(JSON.stringify(symObj), JSON.stringify([g.Symbol("v")]));
console.log(JSON.stringify({ a: [{ b: 1 }, [2]] }, null, 4));
console.log(JSON.stringify({ a: 1 }, null, 20), JSON.stringify({ a: 1 }, null, "123456789012"));
const hole: any = new g.Array(3); hole[1] = 1;
console.log(JSON.stringify(hole), JSON.stringify({ m: new Map(), s: new Set() } as any));
