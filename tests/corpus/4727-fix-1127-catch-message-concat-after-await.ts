// A caught error's message concatenated into a string inside a catch, in a function called after an `await`: once the
// module has closures (the Promise executor, the `then` callback), `+` over a dynamic operand must still lower in every
// value model (the plain WasmGC model has no uniform closure entry for ToPrimitive to call through).
function parse(t: string): number {
  const n = parseFloat(t);
  if (Number.isNaN(n)) throw new RangeError(`not a number: ${t}`);
  return n;
}
function tryParse(t: string): number {
  try {
    return parse(t);
  } catch (e) {
    console.log("skipped: " + (e as Error).message);
    console.log((e as Error).name + " / " + String((e as Error).message.length));
    return 0;
  }
}
async function total(xs: string[]): Promise<number> {
  let s = 0;
  for (const t of xs) {
    await new Promise<void>((r) => setTimeout(r, 1));
    s += tryParse(t);
  }
  return s;
}
total(["1", "x", "2.5", "y"]).then((s) => console.log("total", s));
