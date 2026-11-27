// A conditional spread into an index-signature record whose value type has
// no undefined arm: the key appears only when the condition holds.
type Slot = { width: string; format: string };
function slots(dq: boolean, wide: boolean, base: Record<string, Slot>): Record<string, Slot> {
  let reads = 0;
  const make = (width: string): Slot => {
    reads++;
    return { width, format: "f32" };
  };
  const out: Record<string, Slot> = {
    ...base,
    ...(dq ? { atlas: make("4") } : {}),
    ...(wide ? {} : { narrow: make("1") }),
  };
  console.log("reads", reads);
  return out;
}
const base: Record<string, Slot> = { main: { width: "2", format: "u8" } };
for (const [dq, wide] of [[true, true], [false, true], [true, false], [false, false]] as const) {
  const r = slots(dq, wide, base);
  console.log(Object.keys(r).map((k) => `${k}=${r[k]!.width}`).join(","));
}
