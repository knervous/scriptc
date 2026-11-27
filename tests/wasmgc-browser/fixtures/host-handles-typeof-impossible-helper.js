// React DOM's old-IE probe, in JS as React ships it.
export function probe(event) {
  const a = "unknown" !== typeof event.cancelBubble;
  const b = "unknown" === typeof event.cancelBubble;
  return [a, b];
}
export function kinds(v) {
  return [typeof v === "unknown", typeof v !== "date", typeof v === "number"];
}
