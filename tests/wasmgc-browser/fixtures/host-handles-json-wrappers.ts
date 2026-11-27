// @options: {"hostHandles": true}
// @native-any-only: JSON.stringify of any-typed values meets the dyn serializer only in the native any model
// @native-sim-skip: page Number/String/Boolean wrapper objects exist only on a web page; a native host has none (js.primitiveWrapperKind answers 0)
// JSON.stringify unwraps page Number / String / Boolean / BigInt wrapper objects (SerializeJSONProperty step 4) in values, in a
// replacer property list and in `space`.
const g = globalThis as any;
const num = new g.Number(5), str = new g.String("hi"), yes = new g.Boolean(true), no = new g.Boolean(false), big = g.Object(g.BigInt(7));
const o: any = { n: num, s: str, y: yes, f: no, arr: [num, str], nested: { v: new g.Number(1.5) } };
console.log(JSON.stringify(o));
console.log(JSON.stringify([num, str, yes, no]), JSON.stringify(num), JSON.stringify(str), JSON.stringify(yes));
console.log(JSON.stringify({ a: 1, b: 2, c: 3 }, [new g.String("a"), new g.Number(3), "b"]));
console.log(JSON.stringify({ a: [1, 2] }, null, new g.Number(2)), JSON.stringify({ a: 1 }, null, new g.String("--")));
try { JSON.stringify({ big }); } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other"); }
const withValueOf = new g.Number(3); withValueOf.valueOf = () => 100;
console.log(JSON.stringify(withValueOf), JSON.stringify(new g.Number(NaN)), JSON.stringify(new g.Number(Infinity)));
const strWithToString = new g.String("x"); strWithToString.toString = () => "custom";
console.log(JSON.stringify(strWithToString));
