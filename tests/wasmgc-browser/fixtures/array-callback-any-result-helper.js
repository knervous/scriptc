// Untyped code: an array method's callback over a typed array whose result is an untyped value's.
export function parameterId(segment, open, close) {
  if (!segment.startsWith(open) || !segment.endsWith(close)) return null;
  const id = segment.slice(1, -1);
  return id && !["[", "]", "{", "}"].some((bracket) => id.includes(bracket)) ? id : null;
}
export function picks(text) {
  const words = ["a", "bb", "ccc"];
  return [words.filter((w) => text.indexOf(w) >= 0 && w), words.find((w) => text.match(w)), words.every((w) => text.length > w.length && w.length), words.findIndex((w) => text.endsWith(w))];
}
