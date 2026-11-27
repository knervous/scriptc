export function descriptors() {
  const out = [];
  const s = (d) => JSON.stringify(d) ?? "undefined";
  out.push(s(Object.getOwnPropertyDescriptor("abc", "1")), s(Object.getOwnPropertyDescriptor("abc", "length")), s(Object.getOwnPropertyDescriptor(7, "x")));
  const arr = JSON.parse("[1,2]");
  out.push(s(Object.getOwnPropertyDescriptor(arr, "0")), s(Object.getOwnPropertyDescriptor(arr, "length")), s(Object.getOwnPropertyDescriptor(arr, "5")));
  function item(value) { return value; }
  item[1] = "first";
  item[1] = "second";
  Object.defineProperty(item, "fixed", { value: 42, enumerable: false, writable: false, configurable: false });
  out.push(s(Object.getOwnPropertyDescriptor(item, "1")), s(Object.getOwnPropertyDescriptor(item, "fixed")), s(Object.getOwnPropertyDescriptor(item, "name")));
  Object.defineProperty(arr, "0", { value: 9 });
  out.push(String(arr[0]), s(Object.getOwnPropertyDescriptor(arr, "0")));
  return out.join("\n");
}
