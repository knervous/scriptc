const decorate = (value, ...suffixes) => "prefix:" + value + ":" + suffixes.join(",");
const identity = (value, ..._suffixes) => value;
function full(value) { return "full:" + arguments.length + ":" + arguments[1] + ":" + value; }
function other(value) { return value; }
export function adapters(flag) {
  const picked = flag ? full : other;
  const first = picked("first", "second", 3);
  const format = flag ? decorate : identity;
  return [first, format("item", "one", "two"), format(42)].join(" ");
}
