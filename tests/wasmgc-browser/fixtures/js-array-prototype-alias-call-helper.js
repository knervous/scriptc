// Array.prototype methods captured as values and called with .call, as Svelte's shared utils do. An array receiver (one the
// caller typed, or one this file made) and an array-like one both answer as the page's generic algorithm would.
export var index_of = Array.prototype.indexOf;
export var includes = Array.prototype.includes;
var last_index_of = Array.prototype.lastIndexOf;
export function run(typed, x) {
  const own = [3, "a", x, NaN, 3];
  const like = { length: 3, 0: "p", 1: x, 2: "q" };
  return [
    index_of.call(own, x), index_of.call(own, 3, 1), index_of.call(own, NaN), includes.call(own, NaN), includes.call(own, "z"),
    last_index_of.call(own, 3), index_of.call(typed, 20), includes.call(typed, 30), index_of.call(like, x), includes.call(like, "q"),
    index_of.call("abcb", "b"),
  ].join(" ");
}
