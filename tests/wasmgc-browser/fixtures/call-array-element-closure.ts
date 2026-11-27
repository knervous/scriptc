// Calling a function-typed array element directly: `handlers[i](x)`, `map.get(k)![0](x)`. The element
// is a typed closure slot, not a native method lookup, whatever the parameter types are.
function main() {
  const arr: Array<(b: number) => number> = [(b) => b + 1, (b) => b * 2];
  console.log(arr[0](1), arr[1](5));
  for (let i = 0; i < arr.length; i++) console.log(arr[i](i + 10));
  const m = new Map<number, Array<(b: Uint8Array) => void>>();
  const hits: number[] = [];
  const add = (k: number, h: (n: number) => void) => {
    const list = m.get(k) ?? [];
    list.push((bytes: Uint8Array) => h(bytes.length + 1));
    m.set(k, list);
  };
  add(2, (v) => hits.push(v));
  add(2, (v) => hits.push(v * 10));
  m.get(2)![0](new Uint8Array([1]));
  m.get(2)![1](new Uint8Array([1, 2]));
  console.log(hits.join(","), m.get(2)!.length);
}
main();
