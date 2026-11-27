// @native-any-only: a union with an object arm and a bigint arm (React's ToStringValue) rides the dynamic representation; the bigint stays a bigint.
type ToStringValue = boolean | number | bigint | object | string | null | void;
function toString(value: ToStringValue): string {
  switch (typeof value) {
    case "bigint": return "big" + value.toString();
    case "boolean": case "number": case "object": case "string": return "" + value;
    default: return "";
  }
}
function getToStringValue(value: unknown): ToStringValue {
  switch (typeof value) {
    case "bigint": case "boolean": case "number": case "string": case "undefined": return value;
    case "object": return value as object;
    default: return "";
  }
}
const o = { toString() { return "obj"; } };
console.log(toString(5n), toString(true), toString("s"), toString(null), toString(getToStringValue(7n)), toString(getToStringValue(o)), toString(2 ** 40));
const v = getToStringValue(123456789012345678901234567890n);
console.log(typeof v, v === 123456789012345678901234567890n, v == null);
