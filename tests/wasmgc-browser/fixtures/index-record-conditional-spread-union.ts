// A conditional spread into an index-signature record whose value type is a
// UNION without an undefined arm: the key appears only when the condition holds.
type Fmt = { width: string; format: string | undefined } | { width: string; format: string };
function build(dq: boolean, wide: boolean): Record<string, Fmt> {
  return {
    main: { width: "2", format: "u8" },
    ...(dq ? { atlas: { width: "4", format: undefined } } : {}),
    ...(wide ? {} : { narrow: { width: "1", format: "f32" } }),
  };
}
for (const [dq, wide] of [[true, true], [false, true], [true, false], [false, false]] as const) {
  const r = build(dq, wide);
  console.log(Object.keys(r).map((k) => `${k}=${r[k]!.width}/${r[k]!.format}`).join(","));
}
