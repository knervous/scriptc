function parse(text: string): number {
  const n = parseFloat(text);
  if (Number.isNaN(n)) throw new RangeError(`not a number: ${text}`);
  return n;
}
function tryParse(text: string): number {
  try {
    return parse(text);
  } catch (e) {
    console.error((e as Error).message);
    return 0;
  }
}
async function total(inputs: string[]): Promise<number> {
  let sum = 0;
  for (const t of inputs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    sum += tryParse(t);
  }
  return sum;
}
total(["1", "2.5", "x", "4"]).then((s) => console.log("total", s));
