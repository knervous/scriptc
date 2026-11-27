// @options: {"hostHandles": true}
// @native-any-only: `any` is a checked dyn value only in the native-any lane
// A TypeScript call through an untyped (any / unknown) callee with spread arguments: createElement(type, props, ...children) forwarded exactly.
function viaAny(f: any, props: any, kids: any): any { return f(props, ...kids); }
function viaUnknown(f: unknown, kids: unknown): any { return (f as any)(...(kids as any)); }
function sum(a: number, b: number, c: number, d: number): number { return a + b + c + d; }
const out: string[] = [];
out.push(String(viaAny((p: any, a: any, b: any) => String(p.a) + a + b, { a: 1 }, ["x", "y"])));
out.push(String(viaAny((p: any, a: any) => String(p.a) + String(a), { a: 1 }, [])));
out.push(String(viaAny((_p: any, a: any, b: any, c: any, d: any, e: any) => [a, b, c, d, e].join("-"), {}, ["a", "b", "c", "d", "e"])));
out.push(String(viaUnknown((a: any, b: any) => a + b, ["m", "n"])));
const mixed = (f: any, first: any, rest: any): any => f(first, ...rest, "tail");
out.push(String(mixed((a: any, b: any, c: any, d: any) => [a, b, c, d].join("/"), 1, [2, 3])));
out.push(String(viaAny(sum, 1, [2, 3, 4])));
try { viaAny(() => 0, null, 5); out.push("no throw"); } catch (e) { out.push((e as Error).name); }
try { viaAny(undefined, null, []); out.push("no throw"); } catch (e) { out.push((e as Error).name); }
console.log(out.join("\n"));
