export function protoFacts(arr, slice) {
  return [Object.getPrototypeOf(arr) === Array.prototype, Array.prototype.slice === slice, Array.prototype[Symbol.iterator] === arr.values, Array.prototype.values === arr[Symbol.iterator],
    Array.prototype.concat.call([1], [2], 3).join(), Array.prototype.push.length, Array.prototype.constructor === Array, Object.keys(Array.prototype).length, Array.prototype.hasOwnProperty("map")];
}
