// Casts between any and unknown change only how the value is typed.
function viaUnknown(value: any): unknown {
  return value as unknown;
}
function viaAny(value: unknown): any {
  return value as any;
}
const record = { a: 1, b: "two" };
const back = viaAny(viaUnknown(record));
console.log(back.a, back.b, typeof viaUnknown(3), viaAny("s"), viaAny(undefined) === undefined);
const list: unknown = [1, 2, 3];
console.log((list as any).length, Array.isArray(viaUnknown([4])));
