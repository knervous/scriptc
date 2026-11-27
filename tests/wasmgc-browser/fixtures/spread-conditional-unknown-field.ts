// A conditional spread onto an optional field whose type is a page value / unknown
// (a WebGPU dictionary the compiler holds as a host value): the empty arm leaves the
// field undefined, exactly as the spread leaves the key absent.
interface Options { name: string; blend?: unknown; extra?: unknown }
function build(name: string, blend: { op: string } | undefined, flag: boolean): Options {
  return {
    ...(flag ? { extra: 1 } : {}),
    name,
    ...(blend ? { blend } : {}),
  };
}
function show(o: Options): string { return o.name + " " + JSON.stringify(o.blend) + " " + JSON.stringify(o.extra); }
console.log(show(build("a", undefined, false)));
console.log(show(build("b", { op: "add" }, true)));
export {};
