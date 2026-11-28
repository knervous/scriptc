// pop on an array the caller typed: the last element each time, undefined once empty, and the length one shorter.
export function drain(list) {
  const out = [];
  let v;
  while ((v = list.pop()) !== undefined) out.push(v + ":" + list.length);
  out.push(String(list.pop()), String(list.length));
  return out.join(" ");
}
export function popOne(list) { return list.pop(); }
